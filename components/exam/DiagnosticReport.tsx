"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  MinusCircle,
  Target,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { formatDuration } from "@/lib/exam/format";
import type { ExamOption, OptionLabel } from "@/lib/exam/types";
import { cn } from "@/lib/utils";

export type ReportTopic = {
  id: string;
  title: string;
  correct: number;
  total: number;
  percentage: number;
};

export type ReviewQuestion = {
  id: string;
  /** 1-based position in the paper. */
  number: number;
  text: string;
  options: ExamOption[];
  selectedOption: OptionLabel | null;
  correctOption: OptionLabel;
  explanation: string | null;
  topicId: string;
  topicTitle: string;
  isCorrect: boolean;
};

export type DiagnosticReportProps = {
  attempt: {
    id: string;
    score: number;
    totalQuestions: number;
    timeSpentSeconds: number;
    completedAt: string;
    subjectName: string;
    subjectCode: string | null;
  };
  topics: ReportTopic[];
  questions: ReviewQuestion[];
};

type Filter = "all" | "incorrect" | "unanswered";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "incorrect", label: "Incorrect" },
  { key: "unanswered", label: "Unanswered" },
];

type Tone = {
  label: string;
  /** Hex used for the SVG ring stroke. */
  color: string;
  bar: string;
  text: string;
  badge: string;
  soft: string;
};

function getTone(percentage: number): Tone {
  if (percentage >= 70) {
    return {
      label: "Strong",
      color: "#10b981",
      bar: "bg-emerald-500",
      text: "text-emerald-700",
      badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      soft: "bg-emerald-50/60",
    };
  }

  if (percentage >= 50) {
    return {
      label: "Fair",
      color: "#f59e0b",
      bar: "bg-amber-500",
      text: "text-amber-600",
      badge: "bg-amber-50 text-amber-700 ring-amber-200",
      soft: "bg-amber-50/60",
    };
  }

  return {
    label: "Needs work",
    color: "#ef4444",
    bar: "bg-red-500",
    text: "text-red-600",
    badge: "bg-red-50 text-red-700 ring-red-200",
    soft: "bg-red-50/60",
  };
}

function ProgressRing({
  percentage,
  color,
}: {
  percentage: number;
  color: string;
}) {
  const size = 132;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, percentage) / 100);

  return (
    <div className="relative shrink-0">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="img"
        aria-label={`${percentage}% score`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="text-3xl font-bold tabular-nums leading-none text-slate-900">
            {percentage}%
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Score
          </p>
        </div>
      </div>
    </div>
  );
}

function QuestionStatus({
  isCorrect,
  selected,
}: {
  isCorrect: boolean;
  selected: OptionLabel | null;
}) {
  if (selected === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
        <MinusCircle className="size-3" aria-hidden="true" />
        Not answered
      </span>
    );
  }

  if (isCorrect) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Correct
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
      <XCircle className="size-3" aria-hidden="true" />
      Incorrect
    </span>
  );
}

export default function DiagnosticReport({
  attempt,
  topics,
  questions,
}: DiagnosticReportProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const percentage = Math.round(
    (attempt.score / Math.max(1, attempt.totalQuestions)) * 100,
  );
  const tone = getTone(percentage);

  const incorrectQuestions = useMemo(
    () => questions.filter((q) => !q.isCorrect && q.selectedOption !== null),
    [questions],
  );

  const unansweredQuestions = useMemo(
    () => questions.filter((q) => q.selectedOption === null),
    [questions],
  );

  const weakTopics = useMemo(
    () => topics.filter((topic) => topic.percentage < 50),
    [topics],
  );

  const visibleQuestions = useMemo(() => {
    if (filter === "incorrect") {
      return incorrectQuestions;
    }

    if (filter === "unanswered") {
      return unansweredQuestions;
    }

    return questions;
  }, [filter, incorrectQuestions, questions, unansweredQuestions]);

  const filterCounts: Record<Filter, number> = {
    all: questions.length,
    incorrect: incorrectQuestions.length,
    unanswered: unansweredQuestions.length,
  };

  // Filtering to a problem set opens its explanations automatically.
  const expandByDefault = filter !== "all";

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70 transition-colors hover:text-white"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>

          <p className="mt-5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
            PreJamb &middot; Diagnostic Report
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {attempt.subjectName}
          </h1>
          <p className="mt-1 text-sm text-white/70">
            {attempt.completedAt}
            {attempt.subjectCode ? ` · ${attempt.subjectCode}` : ""}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        {/* ---------------------------------------------------------------- */}
        {/* Score summary                                                    */}
        {/* ---------------------------------------------------------------- */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-6">
              <ProgressRing percentage={percentage} color={tone.color} />

              <div>
                <p className="text-4xl font-bold tabular-nums leading-none text-slate-900">
                  {attempt.score}
                  <span className="text-xl font-semibold text-slate-400">
                    /{attempt.totalQuestions}
                  </span>
                </p>
                <p className="mt-1.5 text-xs font-medium text-slate-500">
                  questions correct
                </p>
                <span
                  className={cn(
                    "mt-2.5 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                    tone.badge,
                  )}
                >
                  {tone.label}
                </span>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-2.5 sm:w-64">
              <div className="rounded-xl bg-slate-50 px-3.5 py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Correct
                </dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums text-emerald-600">
                  {attempt.score}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3.5 py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Incorrect
                </dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums text-red-600">
                  {attempt.totalQuestions - attempt.score}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3.5 py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Unanswered
                </dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums text-slate-700">
                  {questions.length > 0 ? unansweredQuestions.length : "—"}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3.5 py-3">
                <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <Clock className="size-3" aria-hidden="true" />
                  Time
                </dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums text-slate-700">
                  {formatDuration(attempt.timeSpentSeconds)}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Weakness analysis                                                */}
        {/* ---------------------------------------------------------------- */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Target className="size-4 text-primary-600" aria-hidden="true" />
              Weakness analysis
            </h2>
            <p className="text-[11px] font-medium text-slate-500">
              Topics below 50% are flagged
            </p>
          </div>

          {topics.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              There is no topic breakdown for this attempt.
            </p>
          ) : (
            <>
              {weakTopics.length > 0 ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <p>
                    <span className="font-semibold">Focus your revision on:</span>{" "}
                    {weakTopics.map((topic) => topic.title).join(", ")}.
                  </p>
                </div>
              ) : (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <p>No topic fell below 50%. Keep the momentum going.</p>
                </div>
              )}

              <ul className="mt-5 space-y-4">
                {topics.map((topic) => {
                  const topicTone = getTone(topic.percentage);
                  const isWeak = topic.percentage < 50;

                  return (
                    <li key={topic.id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="text-sm font-semibold text-slate-800">
                          {topic.title}
                        </p>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                              topicTone.badge,
                            )}
                          >
                            {topicTone.label}
                          </span>
                          <span className="text-xs font-semibold tabular-nums text-slate-500">
                            {topic.correct}/{topic.total} · {topic.percentage}%
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width] duration-500",
                            topicTone.bar,
                          )}
                          style={{ width: `${topic.percentage}%` }}
                        />
                      </div>
                      {isWeak ? (
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-red-600">
                          <AlertTriangle className="size-3" aria-hidden="true" />
                          Needs attention
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Question review                                                  */}
        {/* ---------------------------------------------------------------- */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Question-by-question review
              </h2>
              {questions.length > 0 ? (
                <p className="text-[11px] font-medium text-slate-500">
                  Select a question to see the explanation
                </p>
              ) : null}
            </div>

            {questions.length > 0 ? (
              <div
                className="mt-4 flex flex-wrap gap-2"
                role="group"
                aria-label="Filter questions"
              >
                {FILTERS.map((item) => {
                  const isActive = filter === item.key;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setFilter(item.key)}
                      aria-pressed={isActive}
                      className={cn(
                        "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
                        isActive
                          ? "bg-primary-600 text-white shadow-sm shadow-primary-600/30"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                      )}
                    >
                      {item.label}
                      <span
                        className={cn(
                          "ml-1.5 tabular-nums",
                          isActive ? "text-white/70" : "text-slate-400",
                        )}
                      >
                        {filterCounts[item.key]}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {questions.length === 0 ? (
            <div className="px-4 py-10 text-center sm:px-6">
              <p className="text-sm font-medium text-slate-700">
                Detailed review is unavailable for this attempt.
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">
                This attempt was saved before per-question answers were
                recorded, so only the score summary and topic breakdown are
                available.
              </p>
            </div>
          ) : visibleQuestions.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-600 sm:px-6">
              Nothing to show in this filter. Good sign.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visibleQuestions.map((question) => {
                const accent =
                  question.selectedOption === null
                    ? "bg-amber-400"
                    : question.isCorrect
                      ? "bg-emerald-500"
                      : "bg-red-500";

                return (
                  <li key={question.id}>
                    <details
                      className="group"
                      open={expandByDefault || undefined}
                    >
                      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-4 hover:bg-slate-50 sm:px-6 [&::-webkit-details-marker]:hidden">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "mt-1.5 h-9 w-1 shrink-0 rounded-full",
                            accent,
                          )}
                        />
                        <span
                          className={cn(
                            "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold ring-1",
                            question.selectedOption === null
                              ? "bg-slate-100 text-slate-600 ring-slate-200"
                              : question.isCorrect
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                : "bg-red-50 text-red-700 ring-red-200",
                          )}
                        >
                          {question.number}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 block text-sm font-medium leading-5 text-slate-800">
                            {question.text}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                              {question.topicTitle}
                            </span>
                            <span>
                              Your answer:{" "}
                              <strong
                                className={cn(
                                  "font-semibold",
                                  question.selectedOption === null
                                    ? "text-slate-500"
                                    : question.isCorrect
                                      ? "text-emerald-700"
                                      : "text-red-600",
                                )}
                              >
                                {question.selectedOption ?? "—"}
                              </strong>
                            </span>
                            <span>
                              Correct:{" "}
                              <strong className="font-semibold text-emerald-700">
                                {question.correctOption}
                              </strong>
                            </span>
                          </span>
                        </span>

                        <span className="hidden shrink-0 sm:block">
                          <QuestionStatus
                            isCorrect={question.isCorrect}
                            selected={question.selectedOption}
                          />
                        </span>

                        <ChevronDown
                          className="mt-1.5 size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                          aria-hidden="true"
                        />
                      </summary>

                      <div className="border-t border-slate-100 bg-slate-50/60 px-4 pb-6 pt-4 sm:px-6">
                        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                          {question.text}
                        </p>

                        <ul className="mt-4 grid gap-2">
                          {question.options.map((option) => {
                            const isCorrectOption =
                              option.label === question.correctOption;
                            const isChosen =
                              option.label === question.selectedOption;

                            return (
                              <li
                                key={option.label}
                                className={cn(
                                  "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm transition-colors",
                                  isCorrectOption
                                    ? "border-emerald-300 bg-emerald-50"
                                    : isChosen
                                      ? "border-red-300 bg-red-50"
                                      : "border-slate-200 bg-white",
                                )}
                              >
                                <span
                                  className={cn(
                                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold",
                                    isCorrectOption
                                      ? "border-emerald-600 bg-emerald-600 text-white"
                                      : isChosen
                                        ? "border-red-500 bg-red-500 text-white"
                                        : "border-slate-300 bg-white text-slate-600",
                                  )}
                                >
                                  {option.label}
                                </span>

                                <span className="flex-1 leading-6 text-slate-800">
                                  {option.text}
                                </span>

                                {isChosen ? (
                                  <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                    Your choice
                                  </span>
                                ) : null}

                                {isCorrectOption ? (
                                  <Check
                                    className="mt-1 size-4 shrink-0 text-emerald-600"
                                    aria-hidden="true"
                                  />
                                ) : isChosen ? (
                                  <X
                                    className="mt-1 size-4 shrink-0 text-red-500"
                                    aria-hidden="true"
                                  />
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>

                        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Step-by-step explanation
                          </h3>

                          {question.explanation ? (
                            <ol className="mt-3 space-y-2.5">
                              {question.explanation
                                .split(/\n+/)
                                .map((step) => step.trim())
                                .filter(Boolean)
                                .map((step, index) => (
                                  <li
                                    key={`${question.id}-step-${index}`}
                                    className="flex gap-3 text-sm leading-6 text-slate-700"
                                  >
                                    <span
                                      className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary-600 text-[10px] font-bold text-white"
                                      aria-hidden="true"
                                    >
                                      {index + 1}
                                    </span>
                                    <span>{step}</span>
                                  </li>
                                ))}
                            </ol>
                          ) : (
                            <p className="mt-2 text-sm text-slate-500">
                              No explanation has been added for this question
                              yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
