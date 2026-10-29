"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  LayoutGrid,
  Loader2,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearExamSnapshot,
  loadExamSnapshot,
  saveExamSnapshot,
} from "@/lib/exam/storage";
import { formatDuration } from "@/lib/exam/format";
import {
  EXAM_DURATION_SECONDS,
  EXAM_SNAPSHOT_VERSION,
  type AnswerMap,
  type ExamQuestion,
  type ExamResult,
  type ExamSnapshot,
  type FlaggedMap,
  type OptionLabel,
} from "@/lib/exam/types";
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
  guestSessionId,
}: ExamRunnerProps) {
  const [hydrated, setHydrated] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [flagged, setFlagged] = useState<FlaggedMap>({});
  const [startedAt, setStartedAt] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);
  const [result, setResult] = useState<ExamResult | null>(null);
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

  const currentQuestion = questions[currentIndex];
  const unansweredCount = questions.length - answeredCount;

  /* ---------------------------------------------------------------------- */
  /* Restore or start the session                                           */
  /* ---------------------------------------------------------------------- */
  /* eslint-disable react-hooks/set-state-in-effect -- This runs once after
     mount on purpose: localStorage is unavailable during SSR, and reading it
     during render would break hydration. It is the standard "sync from an
     external store" case, just spread over several state slices. */
  useEffect(() => {
    const now = Date.now();
    const ownSnapshot = loadExamSnapshot(sessionId, now);
    const guestSnapshot =
      !ownSnapshot && guestSessionId && guestSessionId !== sessionId
        ? loadExamSnapshot(guestSessionId, now)
        : null;
    const stored = ownSnapshot ?? guestSnapshot;

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
      setDeadline(now + EXAM_DURATION_SECONDS * 1000);
    }

    setHydrated(true);
  }, [guestSessionId, sessionId, questions.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ---------------------------------------------------------------------- */
  /* Persist every change                                                   */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    if (!hydrated || result || deadline === 0) {
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
    if (!hydrated || result) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hydrated, result]);

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
        startedAt > 0
          ? Math.round((Date.now() - startedAt) / 1000)
          : EXAM_DURATION_SECONDS;

      const timeSpentSeconds = Math.min(
        EXAM_DURATION_SECONDS,
        Math.max(0, elapsed),
      );

      try {
        const response = await fetch("/api/exam/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId: subject.id,
            questionIds,
            answers,
            timeSpentSeconds,
          }),
        });

        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            readErrorMessage(payload, "We could not submit your exam."),
          );
        }

        if (!isSubmitResponse(payload)) {
          throw new Error("The server returned an unexpected response.");
        }

        setResult({
          ...payload.result,
          timedOut: reason === "timeout",
        });

        // The attempt is safely stored server-side; drop the local draft.
        clearExamSnapshot(sessionId);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "We could not submit your exam. Please try again.",
        );

        if (reason === "timeout") {
          setTimeExpired(true);
        }
      } finally {
        setIsSubmitting(false);
        submittingRef.current = false;
      }
    },
    [answers, questionIds, sessionId, startedAt, subject.id],
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

      setAnswers((previous) => ({ ...previous, [question.id]: label }));
    },
    [currentIndex, questions],
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
        subject={subject}
        candidateName={candidateName}
        questions={questions}
        sessionId={sessionId}
      />
    );
  }

  if (!currentQuestion) {
    return null;
  }

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#4B1D6F] text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
              PreJamb &middot; JAMB UTME Practice
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

          <Timer deadline={deadline} onExpire={handleTimeUp} />

          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center justify-center rounded-md border border-white/25 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:text-sm"
          >
            Submit
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
                  href={`/login?next=${encodeURIComponent(
                    `/exam/session?subject=${subject.code}`,
                  )}`}
                  className="ml-2 font-semibold text-[#4B1D6F] underline-offset-2 hover:underline"
                >
                  Sign in to save
                </Link>
              </>
            ) : null}
          </p>
          <p className="tabular-nums">
            Answered{" "}
            <span className="font-semibold text-emerald-700">
              {answeredCount}
            </span>{" "}
            of {questions.length} &middot; Flagged{" "}
            <span className="font-semibold text-purple-700">
              {flaggedCount}
            </span>
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
          />
        </div>

        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start lg:space-y-3">
          <QuestionPalette
            questionIds={questionIds}
            currentIndex={currentIndex}
            answers={answers}
            flagged={flagged}
            onSelect={handlePaletteSelect}
          />

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Exam rules
            </h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
              <li>&bull; {questions.length} questions &middot; 2 hours</li>
              <li>&bull; One answer per question, options A to D.</li>
              <li>&bull; Progress saves automatically on this device.</li>
              <li>&bull; The exam submits itself when the timer ends.</li>
            </ul>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="mt-4 w-full rounded-md bg-[#0B7A3B] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#096430] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              Submit exam
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
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2
              id="submit-dialog-title"
              className="text-base font-semibold text-slate-900"
            >
              Submit this exam?
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
                  Flagged
                </dt>
                <dd className="text-lg font-bold tabular-nums text-purple-700">
                  {flaggedCount}
                </dd>
              </div>
            </dl>

            <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 ring-1 ring-amber-200">
              Once submitted, your answers cannot be changed.
            </p>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Keep working
              </button>
              <button
                type="button"
                onClick={() => void submitExam("manual")}
                disabled={isSubmitting}
                className="flex-1 rounded-md bg-[#0B7A3B] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#096430] disabled:opacity-60"
              >
                Submit
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
                  className="mx-auto size-8 animate-spin text-[#4B1D6F]"
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
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#4B1D6F] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3d175b]"
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
/* Loading skeleton — also used as the route-level Suspense fallback.         */
/* -------------------------------------------------------------------------- */
export function ExamSkeleton() {
  return (
    <div
      className="min-h-dvh bg-slate-100"
      aria-busy="true"
      aria-label="Loading exam"
    >
      <div className="bg-[#4B1D6F] px-4 py-3 sm:px-6">
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
/* Result screen                                                              */
/* -------------------------------------------------------------------------- */
function ResultScreen({
  result,
  subject,
  candidateName,
  questions,
  sessionId,
}: {
  result: ExamResult;
  subject: { id: string; name: string; code: string };
  candidateName: string;
  questions: ExamQuestion[];
  sessionId: string;
}) {
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

  const handleRetake = () => {
    clearExamSnapshot(sessionId);
    window.location.reload();
  };

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="bg-[#4B1D6F] px-4 py-6 text-white sm:px-6">
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
                Time used
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
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#4B1D6F] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#3d175b]"
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
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-[#0B7A3B] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#096430]"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Take another exam
          </button>
        </div>
      </main>
    </div>
  );
}
