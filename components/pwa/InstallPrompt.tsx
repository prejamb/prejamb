"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * `beforeinstallprompt` fires in Chrome/Edge (desktop + Android) once the PWA
 * is installable. When it does, we surface a compact, dismissible banner
 * instead of silently waiting — a gentle nudge toward "Install PreJamb App
 * for Offline Practice".
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "prejamb:pwa-install-dismissed";

function isAlreadyHidden(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      return true;
    }

    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [hidden, setHidden] = useState<boolean>(isAlreadyHidden);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setDeferred(null);
      setHidden(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred || hidden) {
    return null;
  }

  async function handleInstall() {
    const promptEvent = deferred;

    if (!promptEvent) {
      return;
    }

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;

    setDeferred(null);

    if (choice.outcome === "accepted") {
      setHidden(true);
    }
  }

  function handleDismiss() {
    setDeferred(null);
    setHidden(true);

    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Non-fatal.
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-5">
      <div className="mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-card-lg backdrop-blur-xl sm:gap-4 sm:p-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-800 text-white shadow-md shadow-primary-600/30">
          <Download className="size-5" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Install PreJamb App for Offline Practice
          </p>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            Take exams and review results even without a connection.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleInstall}
            className="rounded-lg bg-gradient-to-b from-primary-600 to-primary-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            Install
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
