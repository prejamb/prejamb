import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import ExamRunner, { ExamSkeleton } from "@/components/exam/ExamRunner";
import {
  EXAM_QUESTION_COUNT,
  parseOptions,
  shuffleWithSeed,
  type ExamQuestion,
} from "@/lib/exam/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "CBT Exam Session | PreJamb",
  description:
    "Timed JAMB UTME practice with a question palette, flagging and instant scoring.",
};

type PageProps = {
  searchParams: Promise<{ subject?: string }>;
};

type SubjectRow = { id: string; name: string; code: string };
type TopicRow = { id: string; title: string };
type QuestionRow = {
  id: string;
  topic_id: string;
  question_text: string;
  options: unknown;
  year: number | null;
};

/**
 * Route entry point.
 *
 * The actual data access lives behind a Suspense boundary because Cache
 * Components (enabled in next.config.ts) requires dynamic reads — cookies and
 * searchParams — to be streamed rather than block the whole route.
 */
export default function ExamSessionPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<ExamSkeleton />}>
      <ExamSession searchParams={searchParams} />
    </Suspense>
  );
}

async function ExamSession({ searchParams }: PageProps) {
  await connection();

  const { subject: requestedCode } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch the subject list (max ~24 rows) so an unknown ?subject= can fall
  // back gracefully instead of throwing a PostgREST error.
  const { data: subjectRows, error: subjectsError } = await supabase
    .from("subjects")
    .select("id, name, code")
    .order("name");

  if (subjectsError) {
    console.error("Failed to load subjects", subjectsError);

    return (
      <ExamMessage
        title="We could not load the exam"
        body="Something went wrong while loading subjects. Please refresh the page or try again shortly."
      />
    );
  }

  const subjects = (subjectRows ?? []) as SubjectRow[];

  if (subjects.length === 0) {
    return (
      <ExamMessage
        title="No subjects available"
        body="The subject table is empty. Run supabase/schema.sql to seed the JAMB UTME subjects, then refresh."
      />
    );
  }

  const requested = requestedCode?.trim().toUpperCase();

  // Default to Use of English, the compulsory paper, when no subject is given.
  const subject = requested
    ? subjects.find((item) => item.code === requested)
    : (subjects.find((item) => item.code === "ENG") ?? subjects[0]);

  if (!subject) {
    notFound();
  }

  const { data: topicRows, error: topicsError } = await supabase
    .from("topics")
    .select("id, title")
    .eq("subject_id", subject.id);

  if (topicsError) {
    console.error("Failed to load topics", topicsError);

    return (
      <ExamMessage
        title="We could not load this subject"
        body="Its topics could not be fetched. Please try again."
      />
    );
  }

  const topics = (topicRows ?? []) as TopicRow[];

  if (topics.length === 0) {
    return (
      <ExamMessage
        title="No topics yet"
        body={`${subject.name} does not have any topics in the question bank yet.`}
      />
    );
  }

  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));

  // Column list must be explicit: `correct_option` and `explanation` are not
  // granted to anon/authenticated (see supabase/schema.sql).
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
    console.error("Failed to load questions", questionsError);

    return (
      <ExamMessage
        title="We could not load the questions"
        body="The question bank could not be fetched. Please try again."
      />
    );
  }

  // One in-progress paper per subject per candidate. Used both as the
  // localStorage key and as the deterministic shuffle seed, so refreshing
  // restores the same questions in the same order.
  const sessionId = `${subject.code}:${user?.id ?? "guest"}`;

  const questions = shuffleWithSeed(
    (questionRows ?? []) as QuestionRow[],
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
    return (
      <ExamMessage
        title="No questions yet"
        body={`${subject.name} has topics but no valid questions. Add questions in Supabase, then refresh.`}
      />
    );
  }

  const userMetadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    typeof userMetadata.full_name === "string"
      ? userMetadata.full_name.trim()
      : "";

  const candidateName =
    fullName || user?.email?.split("@")[0] || "Guest candidate";

  return (
    <ExamRunner
      subject={{ id: subject.id, name: subject.name, code: subject.code }}
      questions={questions}
      sessionId={sessionId}
      guestSessionId={`${subject.code}:guest`}
      candidateName={candidateName}
      isAuthenticated={Boolean(user)}
    />
  );
}

function ExamMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-100 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center justify-center rounded-md bg-[#4B1D6F] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3d175b]"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
