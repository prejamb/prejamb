"use client";

import { useEffect, useState } from "react";

export type NetworkStatus = {
  online: boolean;
  isOnline: boolean;
  isOffline: boolean;
};

/**
 * Tracks `navigator.onLine` plus the `online`/`offline` window events.
 *
 * Initialised to `true` so the first render is hydration-safe; the real value
 * is applied synchronously on mount. Use `isOffline` to decide whether work
 * should be queued for later sync.
 */
export function useNetworkStatus(): NetworkStatus {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);

    update();

    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return { online, isOnline: online, isOffline: !online };
}
