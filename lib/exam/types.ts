/**
 * Shared types, constants and pure helpers for the CBT exam.
 *
 * This module is safe to import from both server and client code — it contains
 * no browser or Node-specific APIs.
 */

/** JAMB UTME papers are 2 hours. */
export const EXAM_DURATION_SECONDS = 120 * 60;

/** A subject session contains 40 questions. */
export const EXAM_QUESTION_COUNT = 40;

/* ------------------------------- exam modes ------------------------------- */

/**
 * The three ways a candidate can sit a paper:
 *
 * - `simulation` — full JAMB rules: 40 questions, 120 minutes, nothing is
 *   revealed until the paper is submitted and graded on the server.
 * - `practice`   — untimed study mode: each question validates as soon as an
 *   option is chosen and shows the explanation. The answer key is delivered by
 *   the server for the chosen paper only (see `app/api/exam/practice`).
 * - `subject`    — a subject-specific mock with an adjustable question count
 *   and a countdown scaled to the number of questions.
 */
export type ExamMode = "simulation" | "practice" | "subject";

export const EXAM_MODES: readonly ExamMode[] = [
  "simulation",
  "practice",
  "subject",
];

/** Practice papers need at least a handful of questions to be worthwhile. */
export const PRACTICE_MIN_QUESTIONS = 5;

/** Counts offered by the subject-mock configurator. */
export const MOCK_QUESTION_COUNTS = [10, 20, 30, 40] as const;

/** JAMB pace: 40 questions in 120 minutes is three minutes per question. */
export const SECONDS_PER_QUESTION = 3 * 60;

/** Never give a mock less than ten minutes, however few questions it has. */
export const MOCK_MIN_DURATION_SECONDS = 10 * 60;

export function isExamMode(value: unknown): value is ExamMode {
  return (
    typeof value === "string" && (EXAM_MODES as readonly string[]).includes(value)
  );
}

/** Falls back to a full simulation when the query string is missing/invalid. */
export function parseExamMode(value: unknown): ExamMode {
  return isExamMode(value) ? value : "simulation";
}

/** Clamps a requested question count into the supported range. */
export function clampQuestionCount(
  value: unknown,
  fallback = MOCK_QUESTION_COUNTS[0],
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : fallback;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    EXAM_QUESTION_COUNT,
    Math.max(PRACTICE_MIN_QUESTIONS, Math.round(parsed)),
  );
}

/**
 * Seconds allowed for a paper. Practice is untimed (0); simulation always gets
 * the full two hours; a subject mock scales with its question count.
 */
export function resolveDurationSeconds(
  mode: ExamMode,
  questionCount: number,
): number {
  if (mode === "practice") {
    return 0;
  }

  if (mode === "simulation") {
    return EXAM_DURATION_SECONDS;
  }

  return Math.min(
    EXAM_DURATION_SECONDS,
    Math.max(MOCK_MIN_DURATION_SECONDS, questionCount * SECONDS_PER_QUESTION),
  );
}

/** Abandoned sessions older than this are discarded instead of resumed. */
export const EXAM_MAX_RESUME_AGE_MS = 12 * 60 * 60 * 1000;

export const OPTION_LABELS = ["A", "B", "C", "D"] as const;
export type OptionLabel = (typeof OPTION_LABELS)[number];

export type ExamOption = {
  label: OptionLabel;
  text: string;
};

export type ExamQuestion = {
  id: string;
  /** 1-based position in this session, used by the palette and card. */
  number: number;
  topicId: string;
  topicTitle: string;
  text: string;
  options: ExamOption[];
  year: number | null;
};

/** Keyed by question id. Missing keys mean "not answered". */
export type AnswerMap = Partial<Record<string, OptionLabel>>;

/** Only flagged questions are stored, so `flagged[id] === true` means flagged. */
export type FlaggedMap = Record<string, boolean>;

/**
 * Answer key for a single question. Only ever sent to the browser in practice
 * mode, where the whole point is immediate validation.
 */
export type QuestionAnswerKey = {
  correctOption: OptionLabel;
  explanation: string | null;
};

/** Keyed by question id. Absent for ungraded modes (simulation/mock). */
export type AnswerKey = Record<string, QuestionAnswerKey>;

/** Presentation copy for each mode, shared by setup, runner and results. */
export const EXAM_MODE_DETAILS: Record<
  ExamMode,
  { label: string; shortLabel: string; description: string }
> = {
  simulation: {
    label: "Simulation Mode",
    shortLabel: "Simulation",
    description:
      "Full JAMB rules across all the subjects you select: 40 questions in 120 minutes. Answers stay locked until you submit and the paper is graded.",
  },
  practice: {
    label: "Practice / Study Mode",
    shortLabel: "Practice",
    description:
      "Untimed and unhurried. Each answer is marked instantly and the explanation appears straight away.",
  },
  subject: {
    label: "Subject-Specific Mock",
    shortLabel: "Subject mock",
    description:
      "Focus on one subject with the question count you choose. The countdown scales with your paper.",
  },
};

/**
 * Body sent to `POST /api/exam/submit`. The offline sync queue stores this
 * exact shape so queued attempts can be replayed verbatim when online.
 */
export type ExamSubmitPayload = {
  /** Primary subject; kept so attempts queued before multi-subject support replay. */
  subjectId: string;
  /** Every subject represented in the paper (multi-subject simulations). */
  subjectIds?: string[];
  questionIds: string[];
  answers: AnswerMap;
  timeSpentSeconds: number;
};

export type TopicScore = {
  correct: number;
  total: number;
};

export type ExamResult = {
  score: number;
  totalQuestions: number;
  percentage: number;
  timeSpentSeconds: number;
  topicBreakdown: Record<string, TopicScore>;
  /** False when the attempt was graded but not persisted (e.g. guest user). */
  saved: boolean;
  /** Primary key of the saved attempt; null for guest attempts. */
  attemptId: string | null;
  message?: string;
  /** Set client-side when the timer expired. */
  timedOut: boolean;
};

export const EXAM_SNAPSHOT_VERSION = 1;

/** The exact shape written to localStorage after every interaction. */
export type ExamSnapshot = {
  version: typeof EXAM_SNAPSHOT_VERSION;
  sessionId: string;
  startedAt: number;
  deadline: number;
  currentIndex: number;
  answers: AnswerMap;
  flagged: FlaggedMap;
};

export function isOptionLabel(value: unknown): value is OptionLabel {
  return (
    typeof value === "string" &&
    (OPTION_LABELS as readonly string[]).includes(value)
  );
}

/**
 * Validates the `questions.options` JSONB column at runtime.
 *
 * The column is validated by a CHECK constraint in Postgres, but JSONB arrives
 * untyped through PostgREST, so we narrow it before trusting it. Returns null
 * when the shape is wrong so the caller can skip the row instead of crashing.
 */
export function parseOptions(value: unknown): ExamOption[] | null {
  if (!Array.isArray(value) || value.length !== OPTION_LABELS.length) {
    return null;
  }

  const options: ExamOption[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }

    const { label, text } = entry as Record<string, unknown>;

    if (!isOptionLabel(label) || seen.has(label)) {
      return null;
    }

    if (typeof text !== "string" || text.trim().length === 0) {
      return null;
    }

    seen.add(label);
    options.push({ label, text: text.trim() });
  }

  return options.sort(
    (a, b) => OPTION_LABELS.indexOf(a.label) - OPTION_LABELS.indexOf(b.label),
  );
}

/** FNV-1a — small, stable string hash used to seed the shuffle. */
function hashSeed(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher-Yates shuffle.
 *
 * Seeding with the session id keeps the question order identical across page
 * refreshes (so the numbering matches the saved palette) while still giving
 * each candidate a different paper.
 */
export function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(hashSeed(seed));
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }

  return shuffled;
}
