"use client";

import { useEffect } from "react";

/**
 * Registers the service worker on first load. Mounted once in the root layout.
 *
 * Registration is production-only: a service worker in `next dev` would serve
 * stale Turbopack chunks and obscure fast refresh. Test the PWA with a
 * production build (`next build && next start`).
 */
export default function SWRegister() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  }, []);

  return null;
}
