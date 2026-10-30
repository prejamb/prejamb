"use client";

import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import ExamRunner, { ExamSkeleton } from "@/components/exam/ExamRunner";
import {
  cacheQuestionSet,
  cacheSubjects,
  getCachedQuestionSet,
  getCachedSubjects,
  getExamCacheKey,
  listCachedQuestionSets,
  type CachedQuestionSet,
  type SubjectRow,
  type TopicRow,
} from "@/lib/db/indexeddb";
import {
  clampQuestionCount,
  EXAM_QUESTION_COUNT,
  parseExamMode,
  parseOptions,
  resolveDurationSeconds,
  shuffleWithSeed,
  type AnswerKey,
  type ExamMode,
  type ExamQuestion,
} from "@/lib/exam/types";
import { useNetworkStatus } from "@/lib/hooks/useNetworkStatus";
import { createClient } from "@/lib/supabase/client";

type ExamSessionShellProps = {
  /** Subject codes from the server-rendered query string. */
  requestedCodes: string[];
  requestedMode: ExamMode;
  requestedCount: number;
};

type Selection = {
  mode: ExamMode;
  /** Ordered subject codes. Simulation honours every code; other modes use one. */
  codes: string[];
  count: number;
};

type ResolvedExam = {
  mode: ExamMode;
  subject: { id: string; name: string; code: string };
  topics: TopicRow[];
  questions: ExamQuestion[];
  answerKey: AnswerKey;
  durationSeconds: number;
  sessionId: string;
  guestSessionId: string;
  candidateName: string;
  isAuthenticated: boolean;
  /** Every subject represented in the paper — needed for server grading. */
  subjectIds: string[];
  /** The live session URL, used to return here after signing in. */
  resumeHref: string;
};

type ShellState =
  | { status: "loading" }
  | { status: "ready"; exam: ResolvedExam }
  | { status: "empty"; offline: boolean; mode: ExamMode };

type SupabaseTopic = { id: string; title: string; subject_id: string };
type SupabaseQuestion = {
  id: string;
  topic_id: string;
  question_text: string;
  options: unknown;
  year: number | null;
};

const DEFAULT_SUBJECT_CODE = "ENG";

/**
 * Client-side exam loader.
 *
 * The page above this is a thin server shell that only reads the query string;
 * all data loading happens here. That means a hard browser refresh while
 * offline never issues a server fetch — it reads the downloaded paper from
 * IndexedDB directly.
 *
 * Three modes share the same runner but load differently:
 * - simulation / subject mock fetch questions without the answer key and are
 *   graded on the server at submission;
 * - practice fetches a paper from `/api/exam/practice`, which includes the key
 *   and explanations, so feedback is instant and survives going offline.
 *
 * Simulation can span several subjects. The paper is built by round-robin
 * across the selected banks so every subject is represented, then capped at
 * the official 40 questions.
 */
export default function ExamSessionShell({
  requestedCodes,
  requestedMode,
  requestedCount,
}: ExamSessionShellProps) {
  const { online } = useNetworkStatus();
  const [state, setState] = useState<ShellState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    // The URL is the source of truth on the client. An offline launch may be
    // served a cached shell that was rendered for a different paper, so
    // re-read the query string and fall back to the server-provided props.
    const selection = readSelection(
      requestedCodes,
      requestedMode,
      requestedCount,
    );

    (async () => {
      // Trust navigator.onLine directly: the hook's initial value is
      // hydration-safe but only corrected after mount.
      const isOnline =
        typeof navigator !== "undefined" ? navigator.onLine : true;

      if (!isOnline) {
        const exam = await loadFromCache(selection);

        if (cancelled) {
          return;
        }

        setState(
          exam
            ? { status: "ready", exam }
            : { status: "empty", offline: true, mode: selection.mode },
        );

        return;
      }

      try {
        const exam = await loadFromNetwork(selection);

        if (cancelled) {
          return;
        }

        setState({ status: "ready", exam });
      } catch (cause) {
        console.error("Failed to load exam session", cause);

        const exam = await loadFromCache(selection);

        if (cancelled) {
          return;
        }

        setState(
          exam
            ? { status: "ready", exam }
            : {
                status: "empty",
                offline: !navigator.onLine,
                mode: selection.mode,
              },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedCodes, requestedMode, requestedCount]);

  if (state.status === "loading") {
    return <ExamSkeleton />;
  }

  if (state.status === "empty") {
    return <EmptyState offline={state.offline} mode={state.mode} />;
  }

  return (
    <div>
      {online ? null : (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900">
          {state.exam.mode === "practice"
            ? "You are offline — this study paper is stored on your device. Feedback and scoring still work."
            : "You are offline — showing the paper downloaded earlier. Your answers will be saved and submitted when you reconnect."}
        </div>
      )}

      <ExamRunner
        mode={state.exam.mode}
        durationSeconds={state.exam.durationSeconds}
        answerKey={
          state.exam.mode === "practice" ? state.exam.answerKey : undefined
        }
        subject={state.exam.subject}
        subjectIds={state.exam.subjectIds}
        resumeHref={state.exam.resumeHref}
        questions={state.exam.questions}
        sessionId={state.exam.sessionId}
        guestSessionId={state.exam.guestSessionId}
        candidateName={state.exam.candidateName}
        isAuthenticated={state.exam.isAuthenticated}
      />
    </div>
  );
}

/** Reads the live query string, falling back to the server-rendered props. */
function readSelection(
  fallbackCodes: string[],
  fallbackMode: ExamMode,
  fallbackCount: number,
): Selection {
  if (typeof window === "undefined") {
    return toSelection(fallbackMode, fallbackCodes, fallbackCount);
  }

  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get("mode");
  const rawCodes = params.get("subjects") ?? params.get("subject");
  const rawCount = params.get("count");

  const mode = rawMode ? parseExamMode(rawMode) : fallbackMode;
  const codes = rawCodes ? rawCodes.split(",") : fallbackCodes;
  const count =
    rawCount === null
      ? resolveCount(mode, fallbackCount)
      : resolveCount(mode, rawCount);

  return toSelection(mode, codes, count);
}

function toSelection(
  mode: ExamMode,
  rawCodes: string[],
  count: number,
): Selection {
  const codes = [
    ...new Set(
      rawCodes
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code.length > 0),
    ),
  ];

  return {
    mode,
    // Practice and subject mocks are always single-subject papers.
    codes: mode === "simulation" ? codes : codes.slice(0, 1),
    count,
  };
}

function resolveCount(mode: ExamMode, value: unknown): number {
  return mode === "simulation"
    ? EXAM_QUESTION_COUNT
    : clampQuestionCount(value, 10);
}

/** Session keys are mode-scoped so practice never resumes a timed mock. */
function buildSessionIds(
  mode: ExamMode,
  codes: string[],
  count: number,
  userId: string | null,
): { sessionId: string; guestSessionId: string } {
  const key = codes.length > 0 ? codes.join("+") : DEFAULT_SUBJECT_CODE;
  const prefix = mode === "simulation" ? key : `${mode}:${key}:${count}`;

  return {
    sessionId: `${prefix}:${userId ?? "guest"}`,
    guestSessionId: `${prefix}:guest`,
  };
}

function simulationCacheKey(codes: string[], questionCount: number): string {
  return codes.length > 1
    ? `simulation:${codes.join("+")}`
    : getExamCacheKey("simulation", codes[0] ?? DEFAULT_SUBJECT_CODE, questionCount);
}

/** The current URL, so signing in returns the candidate to this exact paper. */
function getResumeHref(): string {
  if (typeof window === "undefined") {
    return "/exam/session";
  }

  return `${window.location.pathname}${window.location.search}`;
}

async function resolveIdentity(): Promise<{
  userId: string | null;
  name: string;
}> {
  try {
    const { data } = await createClient().auth.getSession();
    const user = data.session?.user ?? null;

    if (user) {
      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
      const fullName =
        typeof metadata.full_name === "string" &&
        metadata.full_name.trim().length > 0
          ? metadata.full_name.trim()
          : "";

      return {
        userId: user.id,
        name: fullName || user.email?.split("@")[0] || "Candidate",
      };
    }
  } catch {
    // Treat as a guest; the paper is still usable.
  }

  return { userId: null, name: "Guest candidate" };
}

/* -------------------------------------------------------------------------- */
/* Network                                                                    */
/* -------------------------------------------------------------------------- */

function resolveChosenSubjects(
  selection: Selection,
  subjects: SubjectRow[],
): SubjectRow[] {
  const requested =
    selection.mode === "simulation"
      ? selection.codes
      : selection.codes.slice(0, 1);

  const seen = new Set<string>();
  const matches: SubjectRow[] = [];

  for (const code of requested) {
    const subject = subjects.find((item) => item.code === code);

    if (subject && !seen.has(subject.id)) {
      seen.add(subject.id);
      matches.push(subject);
    }
  }

  if (matches.length > 0) {
    return matches;
  }

  // An unknown code falls back to the default paper rather than failing.
  const fallback =
    subjects.find((item) => item.code === DEFAULT_SUBJECT_CODE) ?? subjects[0];

  return [fallback];
}

async function loadFromNetwork(selection: Selection): Promise<ResolvedExam> {
  if (selection.mode === "practice") {
    return loadPracticeFromNetwork(selection);
  }

  const supabase = createClient();

  const { data: subjectRows, error: subjectsError } = await supabase
    .from("subjects")
    .select("id, name, code")
    .order("name");

  if (subjectsError) {
    throw subjectsError;
  }

  const subjects = (subjectRows ?? []) as SubjectRow[];

  if (subjects.length === 0) {
    throw new Error("No subjects available.");
  }

  const chosen = resolveChosenSubjects(selection, subjects);

  const { data: topicRows, error: topicsError } = await supabase
    .from("topics")
    .select("id, title, subject_id")
    .in(
      "subject_id",
      chosen.map((subject) => subject.id),
    );

  if (topicsError) {
    throw topicsError;
  }

  const topics = (topicRows ?? []) as SupabaseTopic[];

  if (topics.length === 0) {
    throw new Error("No topics available.");
  }

  const { data: questionRows, error: questionsError } = await supabase
    .from("questions")
    .select("id, topic_id, question_text, options, year")
    .in(
      "topic_id",
      topics.map((topic) => topic.id),
    )
    .order("id")
    .limit(200 * chosen.length);

  if (questionsError) {
    throw questionsError;
  }

  const { userId, name } = await resolveIdentity();
  const codes = chosen.map((subject) => subject.code);
  const ids = buildSessionIds(
    selection.mode,
    codes,
    selection.count,
    userId,
  );

  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const rows = (questionRows ?? []) as SupabaseQuestion[];

  // One shuffled pool per subject keeps the paper balanced and deterministic.
  const pools = chosen.map((subject) => {
    const pool = rows.filter(
      (row) => topicById.get(row.topic_id)?.subject_id === subject.id,
    );

    return shuffleWithSeed(pool, `${ids.sessionId}:${subject.code}`);
  });

  let ordered: SupabaseQuestion[] = [];

  if (selection.mode === "simulation") {
    // Round-robin across subjects, capped at the official 40 questions.
    const cursors = pools.map(() => 0);
    let added = true;

    while (ordered.length < EXAM_QUESTION_COUNT && added) {
      added = false;

      for (let index = 0; index < pools.length; index += 1) {
        if (ordered.length >= EXAM_QUESTION_COUNT) {
          break;
        }

        const next = pools[index][cursors[index]];

        if (next) {
          ordered.push(next);
          cursors[index] += 1;
          added = true;
        }
      }
    }
  } else {
    ordered = (pools[0] ?? []).slice(0, selection.count);
  }

  const questions = ordered
    .flatMap<ExamQuestion>((row) => {
      const options = parseOptions(row.options);
      const topic = topicById.get(row.topic_id);

      if (!options || !topic) {
        return [];
      }

      return [
        {
          id: row.id,
          number: 0,
          topicId: row.topic_id,
          topicTitle: topic.title,
          text: row.question_text,
          options,
          year: row.year,
        },
      ];
    })
    .map((question, index) => ({ ...question, number: index + 1 }));

  if (questions.length === 0) {
    throw new Error("No questions available.");
  }

  const subjectValue =
    chosen.length === 1
      ? { id: chosen[0].id, name: chosen[0].name, code: chosen[0].code }
      : {
          id: chosen[0].id,
          name: "JAMB UTME Simulation",
          code: codes.join(" · "),
        };

  const topicsValue: TopicRow[] = topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    subjectId: topic.subject_id,
  }));

  // Download the paper for offline reuse.
  void cacheSubjects(subjects);
  void cacheQuestionSet({
    cacheKey: simulationCacheKey(codes, questions.length),
    mode: selection.mode,
    subjectCodes: codes,
    subject: subjectValue,
    topics: topicsValue,
    questions,
    fetchedAt: Date.now(),
  });

  return {
    mode: selection.mode,
    subject: subjectValue,
    subjectIds: chosen.map((subject) => subject.id),
    topics: topicsValue,
    questions,
    answerKey: {},
    durationSeconds: resolveDurationSeconds(selection.mode, questions.length),
    sessionId: ids.sessionId,
    guestSessionId: ids.guestSessionId,
    candidateName: name,
    isAuthenticated: Boolean(userId),
    resumeHref: getResumeHref(),
  };
}

type PracticePaperResponse = {
  paper?: {
    subject?: unknown;
    topics?: unknown;
    questions?: unknown;
    answerKey?: unknown;
    durationSeconds?: unknown;
  };
};

function isExamQuestion(value: unknown): value is ExamQuestion {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const question = value as Record<string, unknown>;

  return (
    typeof question.id === "string" &&
    typeof question.topicId === "string" &&
    typeof question.topicTitle === "string" &&
    typeof question.text === "string" &&
    Array.isArray(question.options) &&
    question.options.length > 0 &&
    typeof question.number === "number"
  );
}

function isAnswerKey(value: unknown): value is AnswerKey {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { correctOption?: unknown }).correctOption === "string",
  );
}

function isTopicRow(value: unknown): value is TopicRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const topic = value as Record<string, unknown>;

  return (
    typeof topic.id === "string" &&
    typeof topic.title === "string" &&
    typeof topic.subjectId === "string"
  );
}

function isSubjectValue(
  value: unknown,
): value is { id: string; name: string; code: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const subject = value as Record<string, unknown>;

  return (
    typeof subject.id === "string" &&
    typeof subject.name === "string" &&
    typeof subject.code === "string"
  );
}

async function loadPracticeFromNetwork(
  selection: Selection,
): Promise<ResolvedExam> {
  const code =
    selection.codes[0]?.trim().toUpperCase() || DEFAULT_SUBJECT_CODE;
  const count = resolveCount("practice", selection.count);

  const params = new URLSearchParams({
    subject: code,
    count: String(count),
  });

  const response = await fetch(`/api/exam/practice?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });

  const payload = (await response
    .json()
    .catch(() => null)) as PracticePaperResponse | null;

  if (!response.ok) {
    throw new Error(
      typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "Could not load this practice paper.",
    );
  }

  const paper = payload?.paper;

  if (!paper || !isSubjectValue(paper.subject)) {
    throw new Error("The practice paper was malformed.");
  }

  const questions = Array.isArray(paper.questions)
    ? paper.questions.filter(isExamQuestion)
    : [];
  const topics = Array.isArray(paper.topics)
    ? paper.topics.filter(isTopicRow)
    : [];
  const answerKey = isAnswerKey(paper.answerKey) ? paper.answerKey : {};

  if (questions.length === 0) {
    throw new Error("No questions are available for this subject yet.");
  }

  const { userId, name } = await resolveIdentity();
  const ids = buildSessionIds(
    "practice",
    [paper.subject.code],
    questions.length,
    userId,
  );

  const topicsValue = topics.length > 0 ? topics : [];
  const questionsValue = questions.map((question, index) => ({
    ...question,
    number: index + 1,
  }));

  void cacheQuestionSet({
    cacheKey: getExamCacheKey("practice", paper.subject.code, questions.length),
    mode: "practice",
    subjectCodes: [paper.subject.code],
    subject: paper.subject,
    topics: topicsValue,
    questions: questionsValue,
    answerKey,
    fetchedAt: Date.now(),
  });

  return {
    mode: "practice",
    subject: paper.subject,
    subjectIds: [paper.subject.id],
    topics: topicsValue,
    questions: questionsValue,
    answerKey,
    durationSeconds: 0,
    sessionId: ids.sessionId,
    guestSessionId: ids.guestSessionId,
    candidateName: name,
    isAuthenticated: Boolean(userId),
    resumeHref: getResumeHref(),
  };
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

async function loadFromCache(selection: Selection): Promise<ResolvedExam | null> {
  if (selection.mode === "practice") {
    return loadPracticeFromCache(selection);
  }

  let set: CachedQuestionSet | null = null;

  if (selection.mode === "simulation" && selection.codes.length > 1) {
    set = await getCachedQuestionSet(
      simulationCacheKey(selection.codes, selection.count),
    ).catch(() => null);
  } else {
    let code = selection.codes[0]?.trim().toUpperCase() || null;

    if (!code) {
      const subjects = await getCachedSubjects().catch(() => []);
      code =
        subjects.find((item) => item.code === DEFAULT_SUBJECT_CODE)?.code ??
        subjects[0]?.code ??
        null;
    }

    if (code) {
      set = await getCachedQuestionSet(
        getExamCacheKey(selection.mode, code, selection.count),
      ).catch(() => null);
    }
  }

  if (!set) {
    // Any downloaded copy for this subject (or the newest paper overall) is
    // better than a dead end when the origin is unreachable.
    const all = (await listCachedQuestionSets().catch(() => []))
      .filter(
        (entry) =>
          entry.mode !== "practice" &&
          Array.isArray(entry.questions) &&
          entry.questions.length > 0,
      )
      .sort((a, b) => b.fetchedAt - a.fetchedAt);

    const requested = selection.codes[0];

    set =
      all.find(
        (entry) =>
          !requested ||
          entry.subject.code === requested ||
          entry.subjectCodes?.includes(requested),
      ) ??
      all[0] ??
      null;
  }

  if (!set) {
    return null;
  }

  const { userId, name } = await resolveIdentity();
  const codes =
    set.subjectCodes && set.subjectCodes.length > 0
      ? set.subjectCodes
      : [set.subject.code];
  const subjectIds = [
    ...new Set(set.topics.map((topic) => topic.subjectId)),
  ];

  return {
    mode: selection.mode,
    subject: set.subject,
    subjectIds:
      subjectIds.length > 0 ? subjectIds : [set.subject.id],
    topics: set.topics,
    questions: set.questions,
    answerKey: {},
    durationSeconds: resolveDurationSeconds(
      selection.mode,
      set.questions.length,
    ),
    ...buildSessionIds(
      selection.mode,
      codes,
      set.questions.length,
      userId,
    ),
    candidateName: name,
    isAuthenticated: Boolean(userId),
    resumeHref: getResumeHref(),
  };
}

async function loadPracticeFromCache(
  selection: Selection,
): Promise<ResolvedExam | null> {
  const code = selection.codes[0]?.trim().toUpperCase() || null;

  const practiceSets = (await listCachedQuestionSets().catch(() => []))
    .filter(
      (entry) =>
        entry.mode === "practice" &&
        entry.answerKey &&
        Array.isArray(entry.questions) &&
        entry.questions.length > 0,
    )
    .sort((a, b) => b.fetchedAt - a.fetchedAt);

  const set =
    practiceSets.find(
      (entry) =>
        (!code || entry.subject.code === code) &&
        entry.questions.length === selection.count,
    ) ??
    practiceSets.find((entry) => !code || entry.subject.code === code) ??
    practiceSets[0] ??
    null;

  if (!set) {
    return null;
  }

  const { userId, name } = await resolveIdentity();

  return {
    mode: "practice",
    subject: set.subject,
    subjectIds: [set.subject.id],
    topics: set.topics,
    questions: set.questions,
    answerKey: set.answerKey ?? {},
    durationSeconds: 0,
    ...buildSessionIds(
      "practice",
      set.subjectCodes ?? [set.subject.code],
      set.questions.length,
      userId,
    ),
    candidateName: name,
    isAuthenticated: Boolean(userId),
    resumeHref: getResumeHref(),
  };
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

const EMPTY_COPY: Record<ExamMode, { title: string; body: string }> = {
  simulation: {
    title: "No offline exam available",
    body: "We could not load this exam and there is no saved copy on your device yet. Take the exam once while online to download it for offline use.",
  },
  subject: {
    title: "No offline mock available",
    body: "This subject-specific mock has not been downloaded on this device. Start it once while online and it will be ready offline.",
  },
  practice: {
    title: "No offline practice paper",
    body: "Practice papers are downloaded the first time you open Practice while online. Open it once with a connection to study offline.",
  },
};

function EmptyState({ offline, mode }: { offline: boolean; mode: ExamMode }) {
  const Icon = offline ? CloudOff : WifiOff;
  const copy = EMPTY_COPY[mode];

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-100 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <Icon className="mx-auto size-8 text-slate-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{copy.body}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </button>
          <Link
            href="/exam/setup"
            className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Choose another mode
          </Link>
        </div>
      </div>
    </div>
  );
}
