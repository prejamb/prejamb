"use client";

import { useEffect } from "react";

import { setupAutoSync } from "@/lib/services/syncService";

/**
 * Mounts once in the root layout so the background sync listener is attached
 * regardless of which route the candidate is on.
 */
export default function OfflineSyncBootstrap() {
  useEffect(() => {
    setupAutoSync();
  }, []);

  return null;
}
