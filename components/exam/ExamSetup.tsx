"use client";

import {
  ArrowRight,
  BookOpenCheck,
  Check,
  Clock,
  GraduationCap,
  ListChecks,
  Loader2,
  Target,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  cacheSubjects,
  getCachedSubjects,
  type SubjectRow,
} from "@/lib/db/indexeddb";
import { formatDuration } from "@/lib/exam/format";
import {
  EXAM_MODE_DETAILS,
  EXAM_QUESTION_COUNT,
  MOCK_QUESTION_COUNTS,
  resolveDurationSeconds,
  type ExamMode,
} from "@/lib/exam/types";
import { useNetworkStatus } from "@/lib/hooks/useNetworkStatus";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Used only when neither IndexedDB nor Supabase can provide the list. */
const FALLBACK_SUBJECTS: SubjectRow[] = [
  { id: "fallback-eng", name: "Use of English", code: "ENG" },
  { id: "fallback-mth", name: "Mathematics", code: "MTH" },
  { id: "fallback-phy", name: "Physics", code: "PHY" },
];

const PRACTICE_QUESTION_COUNT = 10;

type ModeOption = {
  mode: ExamMode;
  icon: typeof GraduationCap;
  iconClass: string;
  bullets: string[];
};

const MODE_OPTIONS: ModeOption[] = [
  {
    mode: "simulation",
    icon: GraduationCap,
    iconClass: "from-primary-600 to-primary-800 shadow-primary-600/30",
    bullets: [
      "All selected subjects",
      `${EXAM_QUESTION_COUNT} questions`,
      "120 minutes",
    ],
  },
  {
    mode: "practice",
    icon: BookOpenCheck,
    iconClass: "from-primary-600 to-primary-800 shadow-primary-600/30",
    bullets: ["Untimed", "Instant marking", "Explanations"],
  },
  {
    mode: "subject",
    icon: Target,
    iconClass: "from-primary-600 to-primary-800 shadow-primary-600/30",
    bullets: ["One subject", "10–40 questions", "Scaled timer"],
  },
];

/**
 * Exam mode selection.
 *
 * Everything here is client-side so the screen also works from the service
 * worker cache: subjects come from IndexedDB first and are only refreshed from
 * Supabase when a connection is available.
 */
export default function ExamSetup() {
  const { online } = useNetworkStatus();

  const [mode, setMode] = useState<ExamMode>("simulation");
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [subjectCode, setSubjectCode] = useState("ENG");
  const [simulationCodes, setSimulationCodes] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState<number>(20);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await getCachedSubjects().catch(() => [] as SubjectRow[]);

      if (!cancelled && cached.length > 0) {
        setSubjects(cached);
        setLoadingSubjects(false);
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (!cancelled) {
          setLoadingSubjects(false);
        }

        return;
      }

      try {
        const { data } = await createClient()
          .from("subjects")
          .select("id, name, code")
          .order("name");

        if (cancelled) {
          return;
        }

        const rows = (data ?? []) as SubjectRow[];

        if (rows.length > 0) {
          setSubjects(rows);
          void cacheSubjects(rows);
        }
      } catch {
        // Offline or Supabase unavailable — the cached/fallback list is enough.
      } finally {
        if (!cancelled) {
          setLoadingSubjects(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const availableSubjects =
    subjects.length > 0 ? subjects : FALLBACK_SUBJECTS;

  const selectedSubject =
    availableSubjects.find((subject) => subject.code === subjectCode) ??
    availableSubjects[0];

  // No explicit choice means "all available subjects" — the JAMB default.
  const selectedSimulationCodes = useMemo(() => {
    const valid = simulationCodes.filter((code) =>
      availableSubjects.some((subject) => subject.code === code),
    );

    return valid.length > 0
      ? valid
      : availableSubjects.map((subject) => subject.code);
  }, [availableSubjects, simulationCodes]);

  const toggleSimulationSubject = (code: string) => {
    const next = selectedSimulationCodes.includes(code)
      ? selectedSimulationCodes.filter((item) => item !== code)
      : [...selectedSimulationCodes, code];

    // A simulation must always contain at least one subject.
    if (next.length > 0) {
      setSimulationCodes(next);
    }
  };

  const modeDetails = EXAM_MODE_DETAILS[mode];

  const paperQuestionCount =
    mode === "simulation"
      ? EXAM_QUESTION_COUNT
      : mode === "practice"
        ? PRACTICE_QUESTION_COUNT
        : questionCount;

  const durationSeconds = resolveDurationSeconds(mode, paperQuestionCount);

  const startHref = useMemo(() => {
    const params = new URLSearchParams({ mode });

    if (mode === "simulation") {
      params.set("subjects", selectedSimulationCodes.join(","));
    } else {
      params.set("subject", selectedSubject?.code ?? "ENG");
      params.set("count", String(paperQuestionCount));
    }

    return `/exam/session?${params.toString()}`;
  }, [mode, paperQuestionCount, selectedSimulationCodes, selectedSubject]);

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
            PreJamb &middot; Exam setup
          </p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
            Choose how you want to practise
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">
            Sit a strict timed simulation across the subjects you choose, study
            untimed with instant explanations, or drill a single subject with a
            mock sized to your revision.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div
          role="radiogroup"
          aria-label="Exam mode"
          className="grid gap-4 md:grid-cols-3"
        >
          {MODE_OPTIONS.map((option) => {
            const selected = option.mode === mode;
            const Icon = option.icon;
            const details = EXAM_MODE_DETAILS[option.mode];

            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMode(option.mode)}
                className={cn(
                  "group relative flex h-full flex-col rounded-2xl border bg-white p-5 text-left shadow-card transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
                  selected
                    ? "border-primary-500 ring-2 ring-primary-500/25"
                    : "border-slate-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg",
                )}
              >
                <span
                  className={cn(
                    "grid size-11 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm",
                    option.iconClass,
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>

                <h2 className="mt-4 text-base font-semibold text-slate-900">
                  {details.label}
                </h2>
                <p className="mt-1.5 text-sm leading-6 text-slate-600">
                  {details.description}
                </p>

                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {option.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                    >
                      {bullet}
                    </li>
                  ))}
                </ul>

                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-4 top-4 grid size-5 place-items-center rounded-full border transition-all",
                    selected
                      ? "border-primary-600 bg-primary-600 text-white"
                      : "border-slate-300 bg-white text-transparent group-hover:border-primary-300",
                  )}
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
              </button>
            );
          })}
        </div>

        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {modeDetails.label} settings
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {mode === "practice"
                  ? `A quick ${PRACTICE_QUESTION_COUNT}-question study set. Nothing is timed.`
                  : mode === "subject"
                    ? `Countdown scales with the paper: ${formatDuration(durationSeconds)}.`
                    : `${selectedSimulationCodes.length} ${
                        selectedSimulationCodes.length === 1
                          ? "subject"
                          : "subjects"
                      } · ${EXAM_QUESTION_COUNT} questions · strict ${formatDuration(
                        durationSeconds,
                      )} countdown.`}
              </p>
            </div>

            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
                "bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200",
              )}
            >
              <Clock className="size-3" aria-hidden="true" />
              {durationSeconds > 0 ? formatDuration(durationSeconds) : "Untimed"}
            </span>
          </div>

          <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {mode === "simulation" ? "Subjects" : "Subject"}
              </h3>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                {mode === "simulation"
                  ? `${selectedSimulationCodes.length} selected — the paper is balanced across every subject you choose.`
                  : mode === "practice"
                    ? "Each study set focuses on one subject."
                    : "This mock covers a single subject."}
              </p>

              {loadingSubjects && subjects.length === 0 ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  Loading subjects…
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {availableSubjects.map((subject) => {
                    const active =
                      mode === "simulation"
                        ? selectedSimulationCodes.includes(subject.code)
                        : subject.code === selectedSubject?.code;

                    return (
                      <button
                        key={subject.code}
                        type="button"
                        onClick={() =>
                          mode === "simulation"
                            ? toggleSimulationSubject(subject.code)
                            : setSubjectCode(subject.code)
                        }
                        aria-pressed={active}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
                          active
                            ? "border-primary-500 bg-primary-50 text-primary-800 ring-1 ring-primary-500/20"
                            : "border-slate-200 bg-white text-slate-700 hover:border-primary-200 hover:bg-primary-50/40",
                        )}
                      >
                        {mode === "simulation" ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "grid size-4 place-items-center rounded-full border transition-colors",
                              active
                                ? "border-primary-600 bg-primary-600 text-white"
                                : "border-slate-300 bg-white text-transparent",
                            )}
                          >
                            <Check className="size-2.5" strokeWidth={3} />
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            "rounded px-1 py-0.5 text-[10px] font-bold tracking-wide",
                            active
                              ? "bg-primary-600 text-white"
                              : "bg-slate-100 text-slate-600",
                          )}
                        >
                          {subject.code}
                        </span>
                        {subject.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Paper length
              </h3>

              {mode === "subject" ? (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    {MOCK_QUESTION_COUNTS.map((count) => {
                      const active = count === questionCount;

                      return (
                        <button
                          key={count}
                          type="button"
                          onClick={() => setQuestionCount(count)}
                          aria-pressed={active}
                          className={cn(
                            "min-w-14 rounded-xl border px-3 py-2 text-sm font-semibold tabular-nums transition-all",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
                            active
                              ? "border-primary-500 bg-primary-50 text-primary-800 ring-1 ring-primary-500/20"
                              : "border-slate-200 bg-white text-slate-700 hover:border-primary-200 hover:bg-primary-50/40",
                          )}
                        >
                          {count}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    Up to {questionCount} questions &middot;{" "}
                    {formatDuration(durationSeconds)} &middot; three minutes per
                    question, capped at two hours. Shorter papers use whatever is
                    available.
                  </p>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Questions
                    </p>
                    <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                      {paperQuestionCount}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Time
                    </p>
                    <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                      {durationSeconds > 0
                        ? formatDuration(durationSeconds)
                        : "None"}
                    </p>
                  </div>
                  <p className="col-span-2 flex items-start gap-1.5 text-[11px] leading-5 text-slate-500">
                    <ListChecks
                      className="mt-0.5 size-3.5 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                    {mode === "practice"
                      ? "Every option you pick is marked immediately, with an explanation."
                      : mode === "simulation" && selectedSimulationCodes.length > 1
                        ? `One ${EXAM_QUESTION_COUNT}-question paper split across ${selectedSimulationCodes.length} subjects. Answers stay hidden until you submit.`
                        : "Answers stay hidden until you submit; grading happens on the server."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-[11px] leading-5 text-slate-500">
              {!online ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                  <WifiOff className="size-3.5" aria-hidden="true" />
                  Offline — only papers downloaded earlier will start.
                </span>
              ) : (
                "Your progress saves automatically, even if you lose connection."
              )}
            </p>

            <Link
              href={startHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              Start {modeDetails.shortLabel.toLowerCase()}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </section>

        <p className="mt-4 text-center text-[11px] text-slate-500">
          Want to know where you stand? Open the{" "}
          <Link
            href="/exam/results"
            className="font-semibold text-primary-700 underline-offset-2 hover:underline"
          >
            diagnostic report
          </Link>{" "}
          after a timed paper to see your weak topics.
        </p>
      </main>
    </div>
  );
}
