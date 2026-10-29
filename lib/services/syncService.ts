"use client";

import {
  listQueuedAttempts,
  removeQueuedAttempt,
} from "@/lib/db/indexeddb";

export type SyncResult = {
  total: number;
  synced: number;
  failed: number;
};

type SyncListener = (result: SyncResult) => void;

const listeners = new Set<SyncListener>();
let autoSyncBound = false;

function notify(result: SyncResult): void {
  for (const listener of listeners) {
    listener(result);
  }
}

/** Subscribe to sync completions (used by the "saved offline" screen). */
export function onSyncComplete(listener: SyncListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Replays every queued offline attempt to `POST /api/exam/submit`.
 *
 * - Success (2xx)     → remove from the queue.
 * - Rejection (4xx)   → remove too: a bad payload will never succeed on retry.
 * - Network error     → stop and keep the rest for a later attempt.
 */
export async function flushSyncQueue(): Promise<SyncResult> {
  const queue = await listQueuedAttempts();
  let synced = 0;

  for (const attempt of queue) {
    try {
      const response = await fetch("/api/exam/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attempt.payload),
      });

      if (response.ok) {
        await removeQueuedAttempt(attempt.id);
        synced += 1;
        continue;
      }

      if (response.status >= 400 && response.status < 500) {
        await removeQueuedAttempt(attempt.id);
      }
    } catch {
      // Socket is still down — leave the remainder queued and back off.
      break;
    }
  }

  const result: SyncResult = {
    total: queue.length,
    synced,
    failed: queue.length - synced,
  };

  notify(result);

  return result;
}

/**
 * Attaches a one-time listener so queued attempts flush automatically the
 * moment connectivity returns, and once on load in case the tab was reopened
 * while online. Idempotent — safe to call from multiple components.
 */
export function setupAutoSync(): void {
  if (autoSyncBound || typeof window === "undefined") {
    return;
  }

  autoSyncBound = true;

  window.addEventListener("online", () => {
    void flushSyncQueue();
  });

  void flushSyncQueue();
}
