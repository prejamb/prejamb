"use client";

import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import ExamRunner, { ExamSkeleton } from "@/components/exam/ExamRunner";
import {
  cacheQuestionSet,
  cacheSubjects,
  getCachedQuestionSet,
  getCachedSubjects,
  getQuestionSetCacheKey,
  listCachedQuestionSets,
  type CachedQuestionSet,
  type SubjectRow,
  type TopicRow,
} from "@/lib/db/indexeddb";
import {
  EXAM_QUESTION_COUNT,
  parseOptions,
  shuffleWithSeed,
  type ExamQuestion,
} from "@/lib/exam/types";
import { useNetworkStatus } from "@/lib/hooks/useNetworkStatus";
import { createClient } from "@/lib/supabase/client";

type ExamSessionShellProps = {
  requestedCode: string | null;
};

type ResolvedExam = {
  subject: { id: string; name: string; code: string };
  topics: TopicRow[];
  questions: ExamQuestion[];
  sessionId: string;
  candidateName: string;
  isAuthenticated: boolean;
};

type ShellState =
  | { status: "loading" }
  | { status: "ready"; exam: ResolvedExam }
  | { status: "empty"; offline: boolean };

type SupabaseTopic = { id: string; title: string };
type SupabaseQuestion = {
  id: string;
  topic_id: string;
  question_text: string;
  options: unknown;
  year: number | null;
};

/**
 * Client-side exam loader.
 *
 * The page above this is a thin server shell that only reads `?subject=`; all
 * data loading happens here. That means a hard browser refresh while offline
 * never issues a server fetch — it reads the downloaded paper from IndexedDB
 * directly. When online it fetches live, caches the result, and renders the
 * same paper.
 */
export default function ExamSessionShell({
  requestedCode,
}: ExamSessionShellProps) {
  const { online } = useNetworkStatus();
  const [state, setState] = useState<ShellState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    // The URL is the source of truth on the client. An offline launch may be
    // served a cached shell that was rendered for a different subject, so
    // re-read `?subject=` from the live location and fall back to the prop.
    const requested = readSubjectFromLocation() ?? requestedCode;

    (async () => {
      // Trust navigator.onLine directly: the hook's initial value is
      // hydration-safe but only corrected after mount.
      const isOnline =
        typeof navigator !== "undefined" ? navigator.onLine : true;

      if (!isOnline) {
        const exam = await loadFromCache(requested);

        if (cancelled) {
          return;
        }

        setState(
          exam
            ? { status: "ready", exam }
            : { status: "empty", offline: true },
        );

        return;
      }

      try {
        const exam = await loadFromNetwork(requested);

        if (cancelled) {
          return;
        }

        setState({ status: "ready", exam });
      } catch (cause) {
        console.error("Failed to load exam session", cause);

        const exam = await loadFromCache(requested);

        if (cancelled) {
          return;
        }

        setState(
          exam
            ? { status: "ready", exam }
            : { status: "empty", offline: !navigator.onLine },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedCode]);

  if (state.status === "loading") {
    return <ExamSkeleton />;
  }

  if (state.status === "empty") {
    return <EmptyState offline={state.offline} />;
  }

  return (
    <div>
      {online ? null : (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900">
          You are offline — showing the paper downloaded earlier. Your answers
          will be saved and submitted when you reconnect.
        </div>
      )}

      <ExamRunner
        subject={state.exam.subject}
        questions={state.exam.questions}
        sessionId={state.exam.sessionId}
        guestSessionId={`${state.exam.subject.code}:guest`}
        candidateName={state.exam.candidateName}
        isAuthenticated={state.exam.isAuthenticated}
      />
    </div>
  );
}

/** Reads the requested subject from the live URL (client only). */
function readSubjectFromLocation(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = new URLSearchParams(window.location.search).get("subject");

  return value && value.trim().length > 0 ? value.trim() : null;
}

async function resolveIdentity(): Promise<{
  userId: string | null;
  name: string;
}> {
  try {
    const { data } = await createClient().auth.getSession();
    const user = data.session?.user ?? null;

    if (user) {
      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
      const fullName =
        typeof metadata.full_name === "string" &&
        metadata.full_name.trim().length > 0
          ? metadata.full_name.trim()
          : "";

      return {
        userId: user.id,
        name: fullName || user.email?.split("@")[0] || "Candidate",
      };
    }
  } catch {
    // Treat as a guest; the paper is still usable.
  }

  return { userId: null, name: "Guest candidate" };
}

async function loadFromNetwork(
  requestedCode: string | null,
): Promise<ResolvedExam> {
  const supabase = createClient();

  const { data: subjectRows, error: subjectsError } = await supabase
    .from("subjects")
    .select("id, name, code")
    .order("name");

  if (subjectsError) {
    throw subjectsError;
  }

  const subjects = (subjectRows ?? []) as SubjectRow[];

  if (subjects.length === 0) {
    throw new Error("No subjects available.");
  }

  const requested = requestedCode?.trim().toUpperCase();
  const subject = requested
    ? subjects.find((item) => item.code === requested)
    : (subjects.find((item) => item.code === "ENG") ?? subjects[0]);

  // An unknown code falls back to the default paper rather than failing.
  const chosen =
    subject ?? subjects.find((item) => item.code === "ENG") ?? subjects[0];

  const { data: topicRows, error: topicsError } = await supabase
    .from("topics")
    .select("id, title")
    .eq("subject_id", chosen.id);

  if (topicsError) {
    throw topicsError;
  }

  const topics = (topicRows ?? []) as SupabaseTopic[];

  if (topics.length === 0) {
    throw new Error("No topics available.");
  }

  const { data: questionRows, error: questionsError } = await supabase
    .from("questions")
    .select("id, topic_id, question_text, options, year")
    .in(
      "topic_id",
      topics.map((topic) => topic.id),
    )
    .order("id")
    .limit(200);

  if (questionsError) {
    throw questionsError;
  }

  const { userId, name } = await resolveIdentity();
  const sessionId = `${chosen.code}:${userId ?? "guest"}`;
  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));

  const questions = shuffleWithSeed(
    (questionRows ?? []) as SupabaseQuestion[],
    sessionId,
  )
    .flatMap<ExamQuestion>((row) => {
      const options = parseOptions(row.options);
      const topicTitle = topicTitles.get(row.topic_id);

      if (!options || !topicTitle) {
        return [];
      }

      return [
        {
          id: row.id,
          number: 0,
          topicId: row.topic_id,
          topicTitle,
          text: row.question_text,
          options,
          year: row.year,
        },
      ];
    })
    .slice(0, EXAM_QUESTION_COUNT)
    .map((question, index) => ({ ...question, number: index + 1 }));

  if (questions.length === 0) {
    throw new Error("No questions available.");
  }

  const subjectValue = { id: chosen.id, name: chosen.name, code: chosen.code };
  const topicsValue: TopicRow[] = topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    subjectId: chosen.id,
  }));

  // Download the paper for offline reuse.
  void cacheSubjects(subjects);
  void cacheQuestionSet({
    cacheKey: getQuestionSetCacheKey(chosen.code),
    subject: subjectValue,
    topics: topicsValue,
    questions,
    fetchedAt: Date.now(),
  });

  return {
    subject: subjectValue,
    topics: topicsValue,
    questions,
    sessionId,
    candidateName: name,
    isAuthenticated: Boolean(userId),
  };
}

async function loadFromCache(
  requestedCode: string | null,
): Promise<ResolvedExam | null> {
  let code = requestedCode?.trim().toUpperCase() || null;

  if (!code) {
    const subjects = await getCachedSubjects().catch(() => []);
    code =
      subjects.find((item) => item.code === "ENG")?.code ??
      subjects[0]?.code ??
      null;
  }

  let set: CachedQuestionSet | null = null;

  if (code) {
    set = await getCachedQuestionSet(getQuestionSetCacheKey(code)).catch(
      () => null,
    );
  }

  if (!set) {
    const all = await listCachedQuestionSets().catch(() => []);
    all.sort((a, b) => b.fetchedAt - a.fetchedAt);
    set = all[0] ?? null;
  }

  if (!set) {
    return null;
  }

  const { userId, name } = await resolveIdentity();

  return {
    subject: set.subject,
    topics: set.topics,
    questions: set.questions,
    sessionId: `${set.subject.code}:${userId ?? "guest"}`,
    candidateName: name,
    isAuthenticated: Boolean(userId),
  };
}

function EmptyState({ offline }: { offline: boolean }) {
  const Icon = offline ? CloudOff : WifiOff;

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-100 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <Icon className="mx-auto size-8 text-slate-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">No offline exam available</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          We could not load this exam and there is no saved copy on your device
          yet. Take the exam once while online to download it for offline use.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
