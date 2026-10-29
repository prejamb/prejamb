/**
 * IndexedDB persistence for PreJamb's offline-first features.
 *
 * Three object stores back three responsibilities:
 *   - `questionSets`  — downloaded papers, keyed per subject, for offline exams
 *   - `examProgress`  — continuously-saved in-progress state (answers, flags,
 *                       timer) so a refresh mid-paper loses nothing
 *   - `syncQueue`     — completed attempts awaiting submission to the server
 *
 * Every public function is safe to call on the server (it rejects when
 * IndexedDB is unavailable) and from any browser. No external dependency: the
 * wrapper is a thin, promise-based layer over the raw IndexedDB API.
 */

import type {
  AnswerMap,
  ExamQuestion,
  ExamSubmitPayload,
  FlaggedMap,
} from "@/lib/exam/types";

const DB_NAME = "prejamb-offline";
const DB_VERSION = 1;

const STORE_QUESTION_SETS = "questionSets";
const STORE_PROGRESS = "examProgress";
const STORE_SYNC_QUEUE = "syncQueue";

let databasePromise: Promise<IDBDatabase> | null = null;

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(
      new Error("IndexedDB is not available in this environment."),
    );
  }

  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(STORE_QUESTION_SETS)) {
          database.createObjectStore(STORE_QUESTION_SETS, {
            keyPath: "cacheKey",
          });
        }

        if (!database.objectStoreNames.contains(STORE_PROGRESS)) {
          database.createObjectStore(STORE_PROGRESS, { keyPath: "sessionId" });
        }

        if (!database.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
          database.createObjectStore(STORE_SYNC_QUEUE, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open IndexedDB."));
      request.onblocked = () =>
        reject(new Error("IndexedDB upgrade was blocked by another tab."));
    });

    // Never cache a failed open — let the next call retry from scratch.
    databasePromise.catch(() => {
      databasePromise = null;
    });
  }

  return databasePromise;
}

function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

async function getFromStore<T>(
  storeName: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);

  return toPromise<T | undefined>(
    store.get(key) as IDBRequest<T | undefined>,
  );
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);

  return toPromise<T[]>(store.getAll() as IDBRequest<T[]>);
}

async function putInStore(storeName: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);

  await toPromise(store.put(value));
}

async function deleteFromStore(
  storeName: string,
  key: IDBValidKey,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);

  await toPromise(store.delete(key));
}

async function clearStore(storeName: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);

  await toPromise(store.clear());
}

/* -------------------------------------------------------------------------- */
/* Question sets                                                              */
/* -------------------------------------------------------------------------- */

export type CachedQuestionSet = {
  cacheKey: string;
  subject: { id: string; name: string; code: string };
  /** Resolved, ordered, numbered questions exactly as they were presented. */
  questions: ExamQuestion[];
  fetchedAt: number;
};

export function getQuestionSetCacheKey(subjectCode: string): string {
  return `subject:${subjectCode.toUpperCase()}`;
}

export async function cacheQuestionSet(
  set: CachedQuestionSet,
): Promise<void> {
  await putInStore(STORE_QUESTION_SETS, set);
}

export async function getCachedQuestionSet(
  cacheKey: string,
): Promise<CachedQuestionSet | null> {
  return (await getFromStore<CachedQuestionSet>(STORE_QUESTION_SETS, cacheKey)) ??
    null;
}

export async function listCachedQuestionSets(): Promise<CachedQuestionSet[]> {
  return getAllFromStore<CachedQuestionSet>(STORE_QUESTION_SETS);
}

export async function clearQuestionSetCache(): Promise<void> {
  await clearStore(STORE_QUESTION_SETS);
}

/* -------------------------------------------------------------------------- */
/* Exam progress                                                              */
/* -------------------------------------------------------------------------- */

export type OfflineExamProgress = {
  sessionId: string;
  answers: AnswerMap;
  flagged: FlaggedMap;
  currentIndex: number;
  startedAt: number;
  deadline: number;
  updatedAt: number;
};

export async function saveExamProgress(
  progress: OfflineExamProgress,
): Promise<void> {
  await putInStore(STORE_PROGRESS, progress);
}

export async function loadExamProgress(
  sessionId: string,
): Promise<OfflineExamProgress | null> {
  return (await getFromStore<OfflineExamProgress>(STORE_PROGRESS, sessionId)) ??
    null;
}

export async function clearExamProgress(sessionId: string): Promise<void> {
  await deleteFromStore(STORE_PROGRESS, sessionId);
}

/* -------------------------------------------------------------------------- */
/* Sync queue                                                                 */
/* -------------------------------------------------------------------------- */

export type QueuedAttempt = {
  id: string;
  createdAt: number;
  payload: ExamSubmitPayload;
};

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueueAttempt(
  payload: ExamSubmitPayload,
): Promise<QueuedAttempt> {
  const attempt: QueuedAttempt = {
    id: makeId(),
    createdAt: Date.now(),
    payload,
  };

  await putInStore(STORE_SYNC_QUEUE, attempt);

  return attempt;
}

export async function listQueuedAttempts(): Promise<QueuedAttempt[]> {
  const attempts = await getAllFromStore<QueuedAttempt>(STORE_SYNC_QUEUE);

  return attempts.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeQueuedAttempt(id: string): Promise<void> {
  await deleteFromStore(STORE_SYNC_QUEUE, id);
}

export async function countQueuedAttempts(): Promise<number> {
  return (await getAllFromStore<QueuedAttempt>(STORE_SYNC_QUEUE)).length;
}

export async function clearSyncQueue(): Promise<void> {
  await clearStore(STORE_SYNC_QUEUE);
}
