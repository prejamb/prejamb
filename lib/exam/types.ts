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
