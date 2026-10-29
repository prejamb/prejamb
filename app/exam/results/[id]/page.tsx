import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import DiagnosticReport, {
  type ReportTopic,
  type ReviewQuestion,
} from "@/components/exam/DiagnosticReport";
import { formatAttemptDate } from "@/lib/exam/format";
import { isOptionLabel, parseOptions } from "@/lib/exam/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Diagnostic Report | PreJamb",
  description:
    "Review your JAMB UTME practice result: score, weak topics and question-by-question explanations.",
};

type PageProps = {
  params: Promise<{ id: string }>;
};

type AttemptRow = {
  id: string;
  score: number;
  total_questions: number;
  time_spent_seconds: number;
  topic_breakdown: unknown;
  created_at: string;
};

type AnswerRow = {
  question_id: string;
  position: number;
  selected_option: string | null;
  is_correct: boolean;
};

type QuestionRow = {
  id: string;
  topic_id: string;
  question_text: string;
  options: unknown;
  correct_option: string;
  explanation: string | null;
};

type TopicRow = {
  id: string;
  title: string;
  subject_id: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ExamResultsPage({ params }: PageProps) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <ResultsContent params={params} />
    </Suspense>
  );
}

async function ResultsContent({ params }: PageProps) {
  await connection();

  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <ReportMessage
        title="Sign in to view this result"
        body="Diagnostic reports are private to the candidate who sat the exam."
      />
    );
  }

  // RLS on exam_attempts already restricts this to the signed-in owner.
  const { data: attemptData, error: attemptError } = await supabase
    .from("exam_attempts")
    .select(
      "id, score, total_questions, time_spent_seconds, topic_breakdown, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (attemptError) {
    console.error("Failed to load exam attempt", attemptError);

    return (
      <ReportMessage
        title="We could not load this result"
        body="Something went wrong while loading the attempt. Please try again shortly."
      />
    );
  }

  if (!attemptData) {
    notFound();
  }

  const attempt = attemptData as AttemptRow;

  let admin: ReturnType<typeof createAdminClient>;

  try {
    admin = createAdminClient();
  } catch (cause) {
    console.error("Diagnostic report is not configured", cause);

    return (
      <ReportMessage
        title="Report unavailable"
        body="The server is missing its Supabase service-role configuration."
      />
    );
  }

  // Per-question answers are server-only under RLS; ownership was established
  // above by reading the parent attempt through the user's session.
  const { data: answerData, error: answersError } = await admin
    .from("exam_attempt_answers")
    .select("question_id, position, selected_option, is_correct")
    .eq("attempt_id", id)
    .order("position", { ascending: true });

  if (answersError) {
    console.error("Failed to load attempt answers", answersError);
  }

  const answerRows = (answerData ?? []) as AnswerRow[];
  const questionIds = [...new Set(answerRows.map((row) => row.question_id))];

  let questionRows: QuestionRow[] = [];

  if (questionIds.length > 0) {
    const { data, error } = await admin
      .from("questions")
      .select(
        "id, topic_id, question_text, options, correct_option, explanation",
      )
      .in("id", questionIds);

    if (error) {
      console.error("Failed to load review questions", error);
    } else {
      questionRows = (data ?? []) as QuestionRow[];
    }
  }

  const breakdown =
    typeof attempt.topic_breakdown === "object" &&
    attempt.topic_breakdown !== null
      ? (attempt.topic_breakdown as Record<
          string,
          { correct?: unknown; total?: unknown }
        >)
      : {};

  const topicIds = new Set<string>(Object.keys(breakdown));

  for (const question of questionRows) {
    topicIds.add(question.topic_id);
  }

  let topicRows: TopicRow[] = [];

  if (topicIds.size > 0) {
    const { data, error } = await admin
      .from("topics")
      .select("id, title, subject_id")
      .in("id", [...topicIds]);

    if (error) {
      console.error("Failed to load topics for report", error);
    } else {
      topicRows = (data ?? []) as TopicRow[];
    }
  }

  const topicTitleById = new Map(
    topicRows.map((topic) => [topic.id, topic.title]),
  );

  let subjectName = "JAMB UTME";
  let subjectCode: string | null = null;
  const subjectId = topicRows[0]?.subject_id;

  if (subjectId) {
    const { data: subject } = await admin
      .from("subjects")
      .select("name, code")
      .eq("id", subjectId)
      .maybeSingle();

    if (subject) {
      subjectName = subject.name as string;
      subjectCode = subject.code as string;
    }
  }

  // Weakest topics first, which is the order a candidate should revise in.
  const topics: ReportTopic[] = Object.entries(breakdown)
    .map(([topicId, raw]) => {
      const total = toCount(raw?.total);
      const correct = Math.min(toCount(raw?.correct), total);

      return {
        id: topicId,
        title: topicTitleById.get(topicId) ?? "Unknown topic",
        correct,
        total,
        percentage: total > 0 ? Math.round((correct / total) * 100) : 0,
      };
    })
    .sort(
      (a, b) => a.percentage - b.percentage || a.title.localeCompare(b.title),
    );

  const questionById = new Map(
    questionRows.map((question) => [question.id, question]),
  );

  const reviewQuestions: ReviewQuestion[] = [];

  for (const answer of answerRows) {
    const question = questionById.get(answer.question_id);

    if (!question) {
      continue;
    }

    const options = parseOptions(question.options);

    if (!options || !isOptionLabel(question.correct_option)) {
      continue;
    }

    reviewQuestions.push({
      id: question.id,
      number: answer.position + 1,
      text: question.question_text,
      options,
      selectedOption: isOptionLabel(answer.selected_option)
        ? answer.selected_option
        : null,
      correctOption: question.correct_option,
      explanation: question.explanation,
      topicId: question.topic_id,
      topicTitle: topicTitleById.get(question.topic_id) ?? "Unknown topic",
      isCorrect: answer.is_correct,
    });
  }

  return (
    <DiagnosticReport
      attempt={{
        id: attempt.id,
        score: attempt.score,
        totalQuestions: attempt.total_questions,
        timeSpentSeconds: attempt.time_spent_seconds,
        completedAt: formatAttemptDate(attempt.created_at),
        subjectName,
        subjectCode,
      }}
      topics={topics}
      questions={reviewQuestions}
    />
  );
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function ReportMessage({ title, body }: { title: string; body: string }) {
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

function ReportSkeleton() {
  return (
    <div className="min-h-dvh bg-slate-100" aria-busy="true" aria-label="Loading report">
      <div className="bg-[#4B1D6F] px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-3">
          <div className="h-2 w-24 rounded bg-white/20" />
          <div className="h-5 w-48 rounded bg-white/30" />
          <div className="h-3 w-36 rounded bg-white/20" />
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
        <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="h-56 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    </div>
  );
}
