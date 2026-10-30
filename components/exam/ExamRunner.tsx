"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  CloudOff,
  LayoutGrid,
  Loader2,
  RefreshCw,
  RotateCcw,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearExamProgress,
  enqueueAttempt,
  loadExamProgress,
  saveExamProgress,
  type QueuedAttempt,
} from "@/lib/db/indexeddb";
import { gradePaper } from "@/lib/exam/grading";
import {
  clearExamSnapshot,
  loadExamSnapshot,
  saveExamSnapshot,
} from "@/lib/exam/storage";
import { formatClock, formatDuration } from "@/lib/exam/format";
import {
  EXAM_DURATION_SECONDS,
  EXAM_MAX_RESUME_AGE_MS,
  EXAM_MODE_DETAILS,
  EXAM_SNAPSHOT_VERSION,
  type AnswerKey,
  type AnswerMap,
  type ExamMode,
  type ExamQuestion,
  type ExamResult,
  type ExamSnapshot,
  type ExamSubmitPayload,
  type FlaggedMap,
  type OptionLabel,
} from "@/lib/exam/types";
import { useNetworkStatus } from "@/lib/hooks/useNetworkStatus";
import { flushSyncQueue, onSyncComplete } from "@/lib/services/syncService";
import { cn } from "@/lib/utils";

import QuestionCard from "./QuestionCard";
import QuestionPalette from "./QuestionPalette";
import Timer from "./Timer";

type ExamRunnerProps = {
  subject: { id: string; name: string; code: string };
  questions: ExamQuestion[];
  /** Stable key for localStorage — one in-progress paper per subject/user. */
  sessionId: string;
  candidateName: string;
  isAuthenticated: boolean;
  /** Which experience this paper belongs to. */
  mode: ExamMode;
  /** Countdown length in seconds; 0 means untimed (practice). */
  durationSeconds: number;
  /** Only provided in practice mode, where answers are revealed on selection. */
  answerKey?: AnswerKey;
  /** Every subject represented by the paper (multi-subject simulations). */
  subjectIds?: string[];
  /** Live session URL, used to return here after signing in. */
  resumeHref?: string;
  /**
   * localStorage key used while the candidate was a guest. If they sign in
   * mid-exam the draft is adopted under the new user-scoped key, so their
   * answers are not lost and the submission is linked to their account.
   */
  guestSessionId?: string;
};

type SubmitResponse = {
  result: Omit<ExamResult, "timedOut">;
};

type PendingSubmission = {
  attempt: QueuedAttempt;
  timedOut: boolean;
};

function isSubmitResponse(value: unknown): value is SubmitResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const result = (value as { result?: unknown }).result;

  if (typeof result !== "object" || result === null) {
    return false;
  }

  const body = result as Record<string, unknown>;

  return (
    typeof body.score === "number" &&
    typeof body.totalQuestions === "number" &&
    typeof body.percentage === "number" &&
    typeof body.timeSpentSeconds === "number" &&
    typeof body.saved === "boolean" &&
    (body.attemptId === null || typeof body.attemptId === "string") &&
    typeof body.topicBreakdown === "object" &&
    body.topicBreakdown !== null
  );
}

function readErrorMessage(value: unknown, fallback: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  ) {
    return (value as { error: string }).error;
  }

  return fallback;
}

export default function ExamRunner({
  subject,
  questions,
  sessionId,
  candidateName,
  isAuthenticated,
  mode,
  durationSeconds,
  answerKey,
  subjectIds,
  resumeHref,
  guestSessionId,
}: ExamRunnerProps) {
  const { online } = useNetworkStatus();
  const isPractice = mode === "practice";
  const modeDetails = EXAM_MODE_DETAILS[mode];

  const [hydrated, setHydrated] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [flagged, setFlagged] = useState<FlaggedMap>({});
  const [startedAt, setStartedAt] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [pendingSync, setPendingSync] = useState<PendingSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const submittingRef = useRef(false);

  const questionIds = useMemo(
    () => questions.map((question) => question.id),
    [questions],
  );

  const answeredCount = useMemo(
    () =>
      questions.reduce(
        (count, question) => (answers[question.id] ? count + 1 : count),
        0,
      ),
    [answers, questions],
  );

  const flaggedCount = useMemo(
    () =>
      questions.reduce(
        (count, question) => (flagged[question.id] ? count + 1 : count),
        0,
      ),
    [flagged, questions],
  );

  const correctCount = useMemo(() => {
    if (!isPractice || !answerKey) {
      return 0;
    }

    return questions.reduce(
      (count, question) =>
        answers[question.id] === answerKey[question.id]?.correctOption
          ? count + 1
          : count,
      0,
    );
  }, [answerKey, answers, isPractice, questions]);

  const currentQuestion = questions[currentIndex];
  const unansweredCount = questions.length - answeredCount;

  /* ---------------------------------------------------------------------- */
  /* Restore or start the session                                           */
  /* ---------------------------------------------------------------------- */
  // Runs once after mount: localStorage and IndexedDB are unavailable during
  // SSR, and reading them during render would break hydration.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const now = Date.now();
      const ownSnapshot = loadExamSnapshot(sessionId, now);
      const guestSnapshot =
        !ownSnapshot && guestSessionId && guestSessionId !== sessionId
          ? loadExamSnapshot(guestSessionId, now)
          : null;

      let stored: ExamSnapshot | null = ownSnapshot ?? guestSnapshot;

      // localStorage can be cleared (private browsing, quota). Fall back to the
      // IndexedDB progress mirror before starting a fresh paper.
      if (!stored) {
        const fromIndexedDB = await loadExamProgress(sessionId).catch(
          () => null,
        );

        if (
          fromIndexedDB &&
          now - fromIndexedDB.startedAt >= 0 &&
          now - fromIndexedDB.startedAt < EXAM_MAX_RESUME_AGE_MS
        ) {
          stored = {
            version: EXAM_SNAPSHOT_VERSION,
            sessionId,
            startedAt: fromIndexedDB.startedAt,
            deadline: fromIndexedDB.deadline,
            currentIndex: fromIndexedDB.currentIndex,
            answers: fromIndexedDB.answers,
            flagged: fromIndexedDB.flagged,
          };
        }
      }

      if (cancelled) {
        return;
      }

      if (stored) {
        if (guestSnapshot && guestSessionId) {
          // Signed in mid-exam: move the draft to the user-scoped key so the
          // next autosave writes there and helps avoid a stale guest copy.
          clearExamSnapshot(guestSessionId);
        }

        setAnswers(stored.answers);
        setFlagged(stored.flagged);
        setCurrentIndex(
          Math.min(Math.max(0, stored.currentIndex), questions.length - 1),
        );
        setStartedAt(stored.startedAt);
        setDeadline(stored.deadline);
      } else {
        setStartedAt(now);
        setDeadline(
          durationSeconds > 0 ? now + durationSeconds * 1000 : 0,
        );
      }

      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [durationSeconds, guestSessionId, sessionId, questions.length]);

  /* ---------------------------------------------------------------------- */
  /* Persist every change                                                   */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    // `deadline === 0` is a valid untimed (practice) paper — only wait for
    // hydration and for a finished attempt.
    if (!hydrated || result) {
      return;
    }

    const snapshot: ExamSnapshot = {
      version: EXAM_SNAPSHOT_VERSION,
      sessionId,
      startedAt,
      deadline,
      currentIndex,
      answers,
      flagged,
    };

    const timeoutId = window.setTimeout(() => {
      saveExamSnapshot(snapshot);
      void saveExamProgress({
        sessionId,
        answers,
        flagged,
        currentIndex,
        startedAt,
        deadline,
        updatedAt: Date.now(),
      });
    }, 200);

    return () => window.clearTimeout(timeoutId);
  }, [
    answers,
    currentIndex,
    deadline,
    flagged,
    hydrated,
    result,
    sessionId,
    startedAt,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Guard against accidental navigation mid-exam                           */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    if (!hydrated || result || pendingSync) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hydrated, result, pendingSync]);

  useEffect(() => {
    if (!confirmOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmOpen]);

  /* ---------------------------------------------------------------------- */
  /* Submission                                                             */
  /* ---------------------------------------------------------------------- */
  const queueSubmission = useCallback(
    async (payload: ExamSubmitPayload, reason: "manual" | "timeout") => {
      try {
        const attempt = await enqueueAttempt(payload);

        clearExamSnapshot(sessionId);
        void clearExamProgress(sessionId);

        setPendingSync({ attempt, timedOut: reason === "timeout" });
      } catch (cause) {
        console.error("Failed to queue offline attempt", cause);
        setError(
          "We could not save your exam for offline sync. Please try again.",
        );

        if (reason === "timeout") {
          setTimeExpired(true);
        }
      }
    },
    [sessionId],
  );

  /**
   * Practice mode can grade itself because the key is already on the device.
   * This keeps feedback instant and works offline, unlike simulation/mocks
   * which must be graded by the server.
   */
  const completePracticeLocally = useCallback(
    (timeSpentSeconds: number, message?: string) => {
      const graded = gradePaper(questions, answers, answerKey ?? {});

      setResult({
        ...graded,
        timeSpentSeconds,
        saved: false,
        attemptId: null,
        timedOut: false,
        ...(message ? { message } : {}),
      });

      clearExamSnapshot(sessionId);
      void clearExamProgress(sessionId);
    },
    [answerKey, answers, questions, sessionId],
  );

  const submitExam = useCallback(
    async (reason: "manual" | "timeout") => {
      if (submittingRef.current) {
        return;
      }

      submittingRef.current = true;
      setConfirmOpen(false);
      setIsSubmitting(true);
      setError(null);

      const elapsed =
        startedAt > 0 ? Math.round((Date.now() - startedAt) / 1000) : 0;

      // Timed papers stop counting at their limit; practice has no limit.
      const cap =
        durationSeconds > 0 ? durationSeconds : EXAM_DURATION_SECONDS;

      const timeSpentSeconds = Math.min(cap, Math.max(0, elapsed));

      const payload: ExamSubmitPayload = {
        subjectId: subject.id,
        subjectIds:
          subjectIds && subjectIds.length > 0 ? subjectIds : [subject.id],
        questionIds,
        answers,
        timeSpentSeconds,
      };

      // No connection (or a stale "online" flag): save locally for later sync.
      if (!online) {
        if (isPractice) {
          completePracticeLocally(
            timeSpentSeconds,
            "Practice results are shown on this device only. Finish while online to save the attempt.",
          );
        } else {
          await queueSubmission(payload, reason);
        }

        setIsSubmitting(false);
        submittingRef.current = false;
        return;
      }

      try {
        const response = await fetch("/api/exam/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const responsePayload: unknown = await response
          .json()
          .catch(() => null);

        if (!response.ok) {
          throw new Error(
            readErrorMessage(responsePayload, "We could not submit your exam."),
          );
        }

        if (!isSubmitResponse(responsePayload)) {
          throw new Error("The server returned an unexpected response.");
        }

        setResult({
          ...responsePayload.result,
          timedOut: reason === "timeout",
        });

        // The attempt is safely stored server-side; drop the local draft.
        clearExamSnapshot(sessionId);
        void clearExamProgress(sessionId);
      } catch (cause) {
        // Practice can always fall back to local grading — the key is already
        // on the device, and submitting only persists the attempt.
        if (isPractice) {
          completePracticeLocally(
            timeSpentSeconds,
            "We could not save this attempt, but your results are shown below. Finish while online to keep it in your history.",
          );
        } else if (cause instanceof TypeError || !navigator.onLine) {
          // fetch rejects with a TypeError when the socket is unreachable.
          await queueSubmission(payload, reason);
        } else {
          setError(
            cause instanceof Error
              ? cause.message
              : "We could not submit your exam. Please try again.",
          );

          if (reason === "timeout") {
            setTimeExpired(true);
          }
        }
      } finally {
        setIsSubmitting(false);
        submittingRef.current = false;
      }
    },
    [
      answers,
      completePracticeLocally,
      durationSeconds,
      isPractice,
      online,
      questionIds,
      queueSubmission,
      sessionId,
      startedAt,
      subject.id,
      subjectIds,
    ],
  );

  const handleTimeUp = useCallback(() => {
    setTimeExpired(true);
    void submitExam("timeout");
  }, [submitExam]);

  /* ---------------------------------------------------------------------- */
  /* Navigation                                                             */
  /* ---------------------------------------------------------------------- */
  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex(Math.min(Math.max(0, index), questions.length - 1));
    },
    [questions.length],
  );

  const selectOption = useCallback(
    (label: OptionLabel) => {
      const question = questions[currentIndex];

      if (!question) {
        return;
      }

      // Practice mode locks a question once answered so the revealed answer
      // cannot simply be flipped to the "right" one.
      if (isPractice && answers[question.id]) {
        return;
      }

      setAnswers((previous) => ({ ...previous, [question.id]: label }));
    },
    [answers, currentIndex, isPractice, questions],
  );

  const toggleFlag = useCallback(() => {
    const question = questions[currentIndex];

    if (!question) {
      return;
    }

    setFlagged((previous) => {
      const next = { ...previous };

      if (next[question.id]) {
        delete next[question.id];
      } else {
        next[question.id] = true;
      }

      return next;
    });
  }, [currentIndex, questions]);

  const handlePaletteSelect = useCallback(
    (index: number) => {
      goTo(index);
      setPaletteOpen(false);
    },
    [goTo],
  );

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */
  if (!hydrated) {
    return <ExamSkeleton />;
  }

  if (result) {
    return (
      <ResultScreen
        result={result}
        mode={mode}
        subject={subject}
        candidateName={candidateName}
        questions={questions}
        sessionId={sessionId}
      />
    );
  }

  if (pendingSync) {
    return (
      <QueuedScreen
        pending={pendingSync}
        subject={subject}
        candidateName={candidateName}
        isAuthenticated={isAuthenticated}
      />
    );
  }

  if (!currentQuestion) {
    return null;
  }

  // The shell always supplies the live URL; the fallback keeps the sign-in
  // link usable if the runner is mounted without one.
  const signInParams = new URLSearchParams({ mode });

  if (mode !== "simulation") {
    signInParams.set("subject", subject.code);
    signInParams.set("count", String(questions.length));
  } else if (!subject.code.includes(" · ")) {
    signInParams.set("subjects", subject.code);
  }

  const signInHref = `/login?next=${encodeURIComponent(
    resumeHref ?? `/exam/session?${signInParams.toString()}`,
  )}`;

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="sticky top-16 z-30 border-b border-white/10 bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900 text-white shadow-lg shadow-primary-950/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
              PreJamb &middot; {modeDetails.label}
            </p>
            <div className="mt-0.5 flex items-baseline gap-2">
              <h1 className="truncate text-base font-semibold sm:text-lg">
                {subject.name}
              </h1>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/80">
                {subject.code}
              </span>
            </div>
          </div>

          {durationSeconds > 0 ? (
            <Timer deadline={deadline} onExpire={handleTimeUp} />
          ) : (
            <CountUpTimer startedAt={startedAt} />
          )}

          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center justify-center rounded-xl bg-primary-50 px-4 py-2 text-xs font-semibold text-primary-800 shadow-sm transition-all hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-700 sm:text-sm"
          >
            {isPractice ? "Finish" : "Submit"}
          </button>
        </div>
      </header>

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-xs text-slate-600 sm:px-6">
          <p>
            Candidate:{" "}
            <span className="font-semibold text-slate-900">
              {candidateName}
            </span>
            {!isAuthenticated ? (
              <>
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                  Guest
                </span>
                <Link
                  href={signInHref}
                  className="ml-2 font-semibold text-primary-700 underline-offset-2 hover:underline"
                >
                  Sign in to save
                </Link>
              </>
            ) : null}
            {!online ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                <WifiOff className="size-3" aria-hidden="true" />
                Offline
              </span>
            ) : null}
          </p>
          <p className="tabular-nums">
            Answered{" "}
            <span className="font-semibold text-emerald-700">
              {answeredCount}
            </span>{" "}
            of {questions.length}
            {isPractice ? (
              <>
                {" "}
                &middot; Correct{" "}
                <span className="font-semibold text-primary-700">
                  {correctCount}
                </span>
              </>
            ) : (
              <>
                {" "}
                &middot; Flagged{" "}
                <span className="font-semibold text-primary-700">
                  {flaggedCount}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          {error && !timeExpired ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p>{error}</p>
            </div>
          ) : null}

          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => setPaletteOpen((open) => !open)}
              aria-expanded={paletteOpen}
              aria-controls="exam-question-palette"
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <span className="inline-flex items-center gap-2">
                <LayoutGrid className="size-4" aria-hidden="true" />
                Question palette
              </span>
              <span className="text-xs font-medium tabular-nums text-slate-500">
                {answeredCount}/{questions.length} answered
              </span>
            </button>

            {paletteOpen ? (
              <div id="exam-question-palette" className="mt-3">
                <QuestionPalette
                  questionIds={questionIds}
                  currentIndex={currentIndex}
                  answers={answers}
                  flagged={flagged}
                  onSelect={handlePaletteSelect}
                  answerKey={isPractice ? answerKey : undefined}
                />
              </div>
            ) : null}
          </div>

          <QuestionCard
            question={currentQuestion}
            totalQuestions={questions.length}
            selected={answers[currentQuestion.id] ?? null}
            isFlagged={Boolean(flagged[currentQuestion.id])}
            onSelect={selectOption}
            onToggleFlag={toggleFlag}
            onPrevious={() => goTo(currentIndex - 1)}
            onNext={() => goTo(currentIndex + 1)}
            mode={mode}
            answerKey={isPractice ? answerKey : undefined}
            locked={isPractice && Boolean(answers[currentQuestion.id])}
          />
        </div>

        <aside className="hidden lg:sticky lg:top-32 lg:block lg:self-start lg:space-y-3">
          <QuestionPalette
            questionIds={questionIds}
            currentIndex={currentIndex}
            answers={answers}
            flagged={flagged}
            onSelect={handlePaletteSelect}
            answerKey={isPractice ? answerKey : undefined}
          />

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {isPractice ? "Study rules" : "Exam rules"}
            </h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
              {isPractice ? (
                <>
                  <li>
                    &bull; {questions.length} questions &middot; no time limit
                  </li>
                  <li>&bull; One answer per question, options A to D.</li>
                  <li>&bull; Answers and explanations appear instantly.</li>
                  <li>&bull; The study clock counts up from zero.</li>
                </>
              ) : (
                <>
                  <li>
                    &bull; {questions.length} questions &middot;{" "}
                    {formatDuration(durationSeconds)}
                  </li>
                  <li>&bull; One answer per question, options A to D.</li>
                  <li>&bull; Progress saves automatically on this device.</li>
                  <li>&bull; The exam submits itself when the timer ends.</li>
                </>
              )}
            </ul>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="mt-4 w-full rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              {isPractice ? "Finish practice" : "Submit exam"}
            </button>
          </div>
        </aside>
      </main>

      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-dialog-title"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2
              id="submit-dialog-title"
              className="text-base font-semibold text-slate-900"
            >
              {isPractice ? "Finish this practice session?" : "Submit this exam?"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              You have answered{" "}
              <strong className="text-slate-900">{answeredCount}</strong> of{" "}
              {questions.length} questions.
            </p>

            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                  Answered
                </dt>
                <dd className="text-lg font-bold tabular-nums text-emerald-700">
                  {answeredCount}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                  Unanswered
                </dt>
                <dd className="text-lg font-bold tabular-nums text-slate-700">
                  {unansweredCount}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                  {isPractice ? "Correct" : "Flagged"}
                </dt>
                <dd
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    isPractice ? "text-emerald-700" : "text-primary-700",
                  )}
                >
                  {isPractice ? correctCount : flaggedCount}
                </dd>
              </div>
            </dl>

            <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 ring-1 ring-amber-200">
              {isPractice
                ? "You will see your score and topic breakdown. Answers already revealed cannot be changed."
                : "Once submitted, your answers cannot be changed."}
            </p>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Keep working
              </button>
              <button
                type="button"
                onClick={() => void submitExam("manual")}
                disabled={isSubmitting}
                className="flex-1 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700 disabled:opacity-60"
              >
                {isPractice ? "Finish" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSubmitting || timeExpired ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
            {isSubmitting ? (
              <>
                <Loader2
                  className="mx-auto size-8 animate-spin text-primary-600"
                  aria-hidden="true"
                />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Submitting your answers
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Please keep this tab open.
                </p>
              </>
            ) : (
              <>
                <AlertTriangle
                  className="mx-auto size-8 text-amber-500"
                  aria-hidden="true"
                />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Time is up
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {error ?? "Your exam could not be submitted yet."}
                </p>
                <button
                  type="button"
                  onClick={() => void submitExam("timeout")}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Try submitting again
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Practice stopwatch                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Practice is untimed, so the header counts up from the session's start time
 * instead of imposing a deadline. Deriving the value from `startedAt` keeps it
 * accurate after the tab has been in the background.
 */
function CountUpTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const elapsed =
    startedAt > 0 ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={`${formatClock(elapsed)} of study time`}
      className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-white"
    >
      <Clock className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex flex-col leading-none">
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] opacity-70">
          Study time
        </span>
        <span className="mt-1 font-mono text-base font-bold tabular-nums sm:text-lg">
          {formatClock(elapsed)}
        </span>
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading skeleton — also used as the route-level Suspense fallback.         */
/* -------------------------------------------------------------------------- */
export function ExamSkeleton() {
  return (
    <div
      className="min-h-dvh bg-slate-100"
      aria-busy="true"
      aria-label="Loading exam"
    >
      <div className="bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-2 w-28 rounded bg-white/20" />
            <div className="h-4 w-40 rounded bg-white/30" />
          </div>
          <div className="h-11 w-32 rounded-lg bg-white/15" />
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="h-[420px] animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="hidden h-72 animate-pulse rounded-xl border border-slate-200 bg-white lg:block" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Offline queued screen                                                      */
/* -------------------------------------------------------------------------- */
function QueuedScreen({
  pending,
  subject,
  candidateName,
  isAuthenticated,
}: {
  pending: PendingSubmission;
  subject: { id: string; name: string; code: string };
  candidateName: string;
  isAuthenticated: boolean;
}) {
  const { online } = useNetworkStatus();
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unsubscribe = onSyncComplete((syncResult) => {
      if (syncResult.synced > 0) {
        setSynced(true);
      }
    });

    return unsubscribe;
  }, []);

  const syncNow = async () => {
    setSyncing(true);

    try {
      await flushSyncQueue();
      setSynced(true);
    } finally {
      setSyncing(false);
    }
  };

  const questionCount = pending.attempt.payload.questionIds.length;
  const timeSpent = pending.attempt.payload.timeSpentSeconds;

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900 px-4 py-6 text-white sm:px-6">
        <div className="mx-auto max-w-3xl">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
            PreJamb &middot; CBT Result
          </p>
          <h1 className="mt-1 text-xl font-semibold">{subject.name}</h1>
          <p className="text-sm text-white/70">
            Candidate: {candidateName} &middot; {subject.code}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        {pending.timedOut ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p>Time up. Your answers were saved when the timer reached zero.</p>
          </div>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {synced ? (
            <CheckCircle2
              className="mx-auto size-8 text-emerald-600"
              aria-hidden="true"
            />
          ) : (
            <CloudOff
              className="mx-auto size-8 text-slate-400"
              aria-hidden="true"
            />
          )}

          <h2 className="mt-3 text-base font-semibold text-slate-900">
            {synced ? "Submitted" : "Saved offline"}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-slate-600">
            {synced
              ? "Your exam has been submitted and graded. Check My Results to review it."
              : "Your exam is saved on this device and will be submitted automatically once you are back online."}
          </p>

          <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Questions
              </dt>
              <dd className="text-base font-bold tabular-nums text-slate-900">
                {questionCount}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Time used
              </dt>
              <dd className="text-base font-bold tabular-nums text-slate-900">
                {formatDuration(timeSpent)}
              </dd>
            </div>
          </dl>
        </section>

        <div className="flex flex-col gap-2">
          {synced ? (
            isAuthenticated ? (
              <Link
                href="/exam/results"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700"
              >
                View my results
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700"
              >
                Sign in to track results
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            )
          ) : online ? (
            <button
              type="button"
              onClick={syncNow}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          ) : (
            <p className="inline-flex items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
              <WifiOff className="size-4" aria-hidden="true" />
              Offline — your attempt will sync automatically when you
              reconnect.
            </p>
          )}

          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Result screen                                                              */
/* -------------------------------------------------------------------------- */
function ResultScreen({
  result,
  mode,
  subject,
  candidateName,
  questions,
  sessionId,
}: {
  result: ExamResult;
  mode: ExamMode;
  subject: { id: string; name: string; code: string };
  candidateName: string;
  questions: ExamQuestion[];
  sessionId: string;
}) {
  const isPractice = mode === "practice";
  const modeDetails = EXAM_MODE_DETAILS[mode];

  const topicTitles = useMemo(
    () => new Map(questions.map((question) => [question.topicId, question.topicTitle])),
    [questions],
  );

  const percentage = result.percentage;
  const tone =
    percentage >= 70
      ? "text-emerald-700"
      : percentage >= 50
        ? "text-amber-600"
        : "text-red-600";
  const bar =
    percentage >= 70
      ? "bg-emerald-600"
      : percentage >= 50
        ? "bg-amber-500"
        : "bg-red-500";

  const topicEntries = Object.entries(result.topicBreakdown);

  const router = useRouter();

  const handleRetake = () => {
    clearExamSnapshot(sessionId);
    router.push("/exam/setup");
  };

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900 px-4 py-6 text-white sm:px-6">
        <div className="mx-auto max-w-3xl">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
            PreJamb &middot; {modeDetails.label}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{subject.name}</h1>
          <p className="text-sm text-white/70">
            Candidate: {candidateName} &middot; {subject.code}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        {result.timedOut ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p>
              Time up. Your answers were submitted automatically when the
              timer reached zero.
            </p>
          </div>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Your score
          </p>
          <p className="mt-2 text-5xl font-bold tabular-nums text-slate-900">
            {result.score}
            <span className="text-2xl font-semibold text-slate-400">
              /{result.totalQuestions}
            </span>
          </p>
          <p className={cn("mt-1 text-sm font-bold", tone)}>
            {percentage}% correct
          </p>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full transition-[width]", bar)}
              style={{ width: `${percentage}%` }}
            />
          </div>

          <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                Correct
              </dt>
              <dd className="text-lg font-bold tabular-nums text-emerald-700">
                {result.score}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                Wrong
              </dt>
              <dd className="text-lg font-bold tabular-nums text-red-600">
                {result.totalQuestions - result.score}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                {isPractice ? "Time practised" : "Time used"}
              </dt>
              <dd className="text-lg font-bold tabular-nums text-slate-700">
                {formatDuration(result.timeSpentSeconds)}
              </dd>
            </div>
          </dl>
        </section>

        {!result.saved && result.message ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p>{result.message}</p>
          </div>
        ) : null}

        {topicEntries.length > 0 ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Topic breakdown
            </h2>
            <ul className="mt-4 space-y-3">
              {topicEntries.map(([topicId, stats]) => {
                const topicPercentage =
                  stats.total > 0
                    ? Math.round((stats.correct / stats.total) * 100)
                    : 0;

                return (
                  <li key={topicId}>
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="font-medium text-slate-700">
                        {topicTitles.get(topicId) ?? "Topic"}
                      </span>
                      <span className="font-semibold tabular-nums text-slate-500">
                        {stats.correct}/{stats.total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          topicPercentage >= 70
                            ? "bg-emerald-600"
                            : topicPercentage >= 50
                              ? "bg-amber-500"
                              : "bg-red-500",
                        )}
                        style={{ width: `${topicPercentage}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {result.attemptId ? (
          <Link
            href={`/exam/results/${result.attemptId}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700"
          >
            View full diagnostic report
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/"
            className="inline-flex flex-1 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to home
          </Link>
          <button
            type="button"
            onClick={handleRetake}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {isPractice
              ? "Practise again"
              : mode === "subject"
                ? "Try another mock"
                : "Take another exam"}
          </button>
        </div>
      </main>
    </div>
  );
}
