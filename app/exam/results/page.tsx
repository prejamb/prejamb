import type { Metadata } from "next";
import { ArrowRight, History, Target, Timer, Trophy } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { formatAttemptDate, formatDuration } from "@/lib/exam/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "My Results | PreJamb",
  description:
    "Every JAMB UTME practice attempt saved to your PreJamb account, with scores and topic breakdowns.",
};

type AttemptRow = {
  id: string;
  score: number;
  total_questions: number;
  time_spent_seconds: number;
  topic_breakdown: unknown;
  created_at: string;
};

type TopicRow = {
  id: string;
  title: string;
  subject_id: string;
};

type SubjectRow = {
  id: string;
  name: string;
  code: string;
};

type Breakdown = Record<string, { correct?: unknown; total?: unknown }>;

const ATTEMPT_LIMIT = 100;

export default function ResultsIndexPage() {
  return (
    <Suspense fallback={<ResultsSkeleton />}>
      <ResultsList />
    </Suspense>
  );
}

async function ResultsList() {
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=%2Fexam%2Fresults");
  }

  // RLS limits this to the signed-in candidate's own attempts.
  const { data, error } = await supabase
    .from("exam_attempts")
    .select(
      "id, score, total_questions, time_spent_seconds, topic_breakdown, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(ATTEMPT_LIMIT);

  if (error) {
    console.error("Failed to load attempt history", error);
  }

  const attempts = (data ?? []) as AttemptRow[];
  const breakdowns = new Map<string, Breakdown>();

  for (const attempt of attempts) {
    breakdowns.set(attempt.id, readBreakdown(attempt.topic_breakdown));
  }

  // Attempts do not store a subject id, so it is derived from their topics.
  const topicIds = new Set<string>();

  for (const breakdown of breakdowns.values()) {
    for (const topicId of Object.keys(breakdown)) {
      topicIds.add(topicId);
    }
  }

  let topicRows: TopicRow[] = [];

  if (topicIds.size > 0) {
    const { data: topics } = await supabase
      .from("topics")
      .select("id, title, subject_id")
      .in("id", [...topicIds]);

    topicRows = (topics ?? []) as TopicRow[];
  }

  const subjectIds = [...new Set(topicRows.map((topic) => topic.subject_id))];
  let subjectRows: SubjectRow[] = [];

  if (subjectIds.length > 0) {
    const { data: subjects } = await supabase
      .from("subjects")
      .select("id, name, code")
      .in("id", subjectIds);

    subjectRows = (subjects ?? []) as SubjectRow[];
  }

  const topicById = new Map(topicRows.map((topic) => [topic.id, topic]));
  const subjectById = new Map(
    subjectRows.map((subject) => [subject.id, subject]),
  );

  const rows = attempts.map((attempt) => {
    const total = Math.max(1, attempt.total_questions);
    const percentage = Math.round((attempt.score / total) * 100);
    const breakdown = breakdowns.get(attempt.id) ?? {};

    // A simulation can span several subjects, so collect every subject it
    // touched instead of picking the first topic.
    const attemptSubjectIds = new Set<string>();

    for (const topicId of Object.keys(breakdown)) {
      const topic = topicById.get(topicId);

      if (topic) {
        attemptSubjectIds.add(topic.subject_id);
      }
    }

    const attemptSubjects = [...attemptSubjectIds]
      .map((id) => subjectById.get(id))
      .filter((subject): subject is SubjectRow => Boolean(subject));

    return {
      attempt,
      percentage,
      subjectLabel:
        attemptSubjects.length > 1
          ? `${attemptSubjects.length} subjects`
          : (attemptSubjects[0]?.name ?? "Practice test"),
    };
  });

  const percentages = rows.map((row) => row.percentage);
  const bestPercentage = percentages.length > 0 ? Math.max(...percentages) : 0;
  const averagePercentage =
    percentages.length > 0
      ? Math.round(
          percentages.reduce((sum, value) => sum + value, 0) /
            percentages.length,
        )
      : 0;

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900 text-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-end justify-between gap-3 px-4 py-6 sm:px-6">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
              PreJamb &middot; Progress
            </p>
            <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
              My results
            </h1>
            <p className="mt-0.5 text-sm text-white/70">
              Every saved practice attempt, newest first.
            </p>
          </div>

          <Link
            href="/exam/setup"
            className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3.5 py-2 text-xs font-semibold text-white ring-1 ring-inset ring-white/25 transition-colors hover:bg-white/20"
          >
            New practice
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            We could not load your attempt history. Please refresh the page.
          </div>
        ) : null}

        {rows.length > 0 ? (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              icon={<History className="size-4" aria-hidden="true" />}
              label="Attempts"
              value={String(rows.length)}
            />
            <StatCard
              icon={<Trophy className="size-4" aria-hidden="true" />}
              label="Best score"
              value={`${bestPercentage}%`}
            />
            <StatCard
              icon={<Target className="size-4" aria-hidden="true" />}
              label="Average score"
              value={`${averagePercentage}%`}
            />
          </dl>
        ) : null}

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary-50 text-primary-600">
              <History className="size-6" aria-hidden="true" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-slate-900">
              No saved attempts yet
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
              Complete a practice test while signed in and it will appear here
              with a full diagnostic report.
            </p>
            <Link
              href="/exam/setup"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700"
            >
              Start practicing
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {rows.map(({ attempt, percentage, subjectLabel }) => {
              const tone =
                percentage >= 70
                  ? "border-emerald-500 text-emerald-700"
                  : percentage >= 50
                    ? "border-amber-500 text-amber-600"
                    : "border-red-500 text-red-600";

              return (
                <li key={attempt.id}>
                  <Link
                    href={`/exam/results/${attempt.id}`}
                    className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50/40"
                  >
                    <span
                      className={cn(
                        "grid size-12 shrink-0 place-items-center rounded-full border-4 bg-white text-xs font-bold tabular-nums",
                        tone,
                      )}
                    >
                      {percentage}%
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {subjectLabel}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span>{formatAttemptDate(attempt.created_at)}</span>
                        <span aria-hidden="true">&middot;</span>
                        <span className="tabular-nums">
                          {attempt.score}/{attempt.total_questions} correct
                        </span>
                        <span aria-hidden="true">&middot;</span>
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Timer className="size-3" aria-hidden="true" />
                          {formatDuration(attempt.time_spent_seconds)}
                        </span>
                      </span>
                    </span>

                    <ArrowRight
                      className="size-4 shrink-0 text-slate-400 transition-colors group-hover:text-primary-600"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <span className="text-primary-600">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
        {value}
      </dd>
    </div>
  );
}

function readBreakdown(value: unknown): Breakdown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Breakdown;
}

function ResultsSkeleton() {
  return (
    <div
      className="min-h-dvh bg-slate-100"
      aria-busy="true"
      aria-label="Loading results"
    >
      <div className="bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900 px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-4xl space-y-3">
          <div className="h-2 w-24 rounded bg-white/20" />
          <div className="h-5 w-40 rounded bg-white/30" />
          <div className="h-3 w-56 rounded bg-white/20" />
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-3 px-4 py-5 sm:px-6">
        <div className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    </div>
  );
}
