/**
 * localStorage persistence for an in-progress exam.
 *
 * Every read is defensive: the stored payload is user-editable, can be stale
 * after a deploy, and can be corrupted. Invalid snapshots are discarded rather
 * than trusted.
 */

import {
  EXAM_MAX_RESUME_AGE_MS,
  EXAM_SNAPSHOT_VERSION,
  isOptionLabel,
  type AnswerMap,
  type ExamSnapshot,
  type FlaggedMap,
} from "./types";

const STORAGE_PREFIX = "prejamb:cbt:v1";

export function examStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}:${sessionId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAnswers(value: unknown): AnswerMap {
  if (!isRecord(value)) {
    return {};
  }

  const answers: AnswerMap = {};

  for (const [questionId, label] of Object.entries(value)) {
    if (isOptionLabel(label)) {
      answers[questionId] = label;
    }
  }

  return answers;
}

function parseFlagged(value: unknown): FlaggedMap {
  if (!isRecord(value)) {
    return {};
  }

  const flagged: FlaggedMap = {};

  for (const [questionId, flag] of Object.entries(value)) {
    if (flag === true) {
      flagged[questionId] = true;
    }
  }

  return flagged;
}

export function loadExamSnapshot(
  sessionId: string,
  now: number = Date.now(),
): ExamSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(examStorageKey(sessionId));

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed) || parsed.version !== EXAM_SNAPSHOT_VERSION) {
      clearExamSnapshot(sessionId);
      return null;
    }

    const { startedAt, deadline, currentIndex } = parsed;

    if (
      typeof startedAt !== "number" ||
      !Number.isFinite(startedAt) ||
      typeof deadline !== "number" ||
      !Number.isFinite(deadline)
    ) {
      clearExamSnapshot(sessionId);
      return null;
    }

    // Resume only recent sessions; older ones are abandoned attempts.
    if (now - startedAt > EXAM_MAX_RESUME_AGE_MS || now - startedAt < 0) {
      clearExamSnapshot(sessionId);
      return null;
    }

    return {
      version: EXAM_SNAPSHOT_VERSION,
      sessionId,
      startedAt,
      deadline,
      currentIndex:
        typeof currentIndex === "number" && Number.isFinite(currentIndex)
          ? Math.max(0, Math.floor(currentIndex))
          : 0,
      answers: parseAnswers(parsed.answers),
      flagged: parseFlagged(parsed.flagged),
    };
  } catch {
    return null;
  }
}

export function saveExamSnapshot(snapshot: ExamSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      examStorageKey(snapshot.sessionId),
      JSON.stringify(snapshot),
    );
  } catch {
    // Storage can be full or disabled (private mode, quota). The exam keeps
    // working in memory — we simply lose resume-on-refresh.
  }
}

export function clearExamSnapshot(sessionId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(examStorageKey(sessionId));
  } catch {
    // Nothing useful to do if storage is unavailable.
  }
}
