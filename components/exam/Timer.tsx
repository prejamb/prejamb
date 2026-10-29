"use client";

import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type TimerProps = {
  /** Absolute end time as an epoch timestamp (ms). */
  deadline: number;
  /** Called exactly once, when the countdown reaches zero. */
  onExpire: () => void;
  className?: string;
};

function secondsUntil(deadline: number): number {
  return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
}

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

/**
 * Countdown timer for the CBT header.
 *
 * The remaining time is always derived from the absolute `deadline`, never
 * decremented locally. Browsers throttle `setInterval` in background tabs, so
 * a decrementing counter would drift; recomputing from the deadline keeps the
 * clock honest even after the tab has been asleep.
 */
export default function Timer({ deadline, onExpire, className }: TimerProps) {
  const [remaining, setRemaining] = useState<number | null>(null);

  // Keep the latest callback without restarting the interval on every render.
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!deadline) {
      return;
    }

    let expired = false;
    let intervalId = 0;

    const tick = () => {
      const next = secondsUntil(deadline);
      setRemaining(next);

      if (next <= 0 && !expired) {
        expired = true;

        if (intervalId) {
          window.clearInterval(intervalId);
        }

        onExpireRef.current();
      }
    };

    intervalId = window.setInterval(tick, 1000);
    tick();

    // Correct immediately when the candidate returns to the tab.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalId) {
        window.clearInterval(intervalId);
      }

      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [deadline]);

  const isCritical = remaining !== null && remaining <= 5 * 60;
  const isWarning = remaining !== null && remaining <= 15 * 60;

  const label =
    remaining === null
      ? "Time remaining"
      : `${formatTime(remaining)} remaining`;

  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={label}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors",
        isCritical
          ? "border-red-400/60 bg-red-500/20 text-red-50"
          : isWarning
            ? "border-amber-300/50 bg-amber-400/15 text-amber-50"
            : "border-white/15 bg-white/10 text-white",
        className,
      )}
    >
      <Clock
        className={cn("size-4 shrink-0", isCritical && "animate-pulse")}
        aria-hidden="true"
      />
      <span className="flex flex-col leading-none">
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] opacity-70">
          Time left
        </span>
        <span className="mt-1 font-mono text-base font-bold tabular-nums sm:text-lg">
          {remaining === null ? "--:--:--" : formatTime(remaining)}
        </span>
      </span>
    </div>
  );
}
