import { NextResponse } from "next/server";

import {
  clampQuestionCount,
  parseOptions,
  shuffleWithSeed,
  type AnswerKey,
  type ExamQuestion,
} from "@/lib/exam/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `GET /api/exam/practice?subject=ENG&count=10`
 *
 * Returns a practice paper **including** the answer key and explanations.
 *
 * Simulation and mock papers never expose `questions.correct_option` (see the
 * column grants in supabase/schema.sql) because they are graded on the server.
 * Practice mode is intentionally different: immediate feedback is the feature,
 * so the key for the selected paper is released here and cached on the device
 * for offline study. Nothing else about the bank is exposed, and the response
 * is never cached by shared caches.
 */

const SUBJECT_CODE_PATTERN = /^[A-Z0-9]{2,10}$/;

const MAX_SOURCE_QUESTIONS = 200;

type SubjectRow = { id: string; name: string; code: string };
type TopicRow = { id: string; title: string };
type QuestionRow = {
  id: string;
  topic_id: string;
  question_text: string;
  options: unknown;
  year: number | null;
  correct_option: string;
  explanation: string | null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("subject") ?? "").trim().toUpperCase();
  const count = clampQuestionCount(searchParams.get("count"));

  if (!SUBJECT_CODE_PATTERN.test(code)) {
    return NextResponse.json(
      { error: "A valid subject code is required." },
      { status: 400 },
    );
  }

  let admin: ReturnType<typeof createAdminClient>;

  try {
    admin = createAdminClient();
  } catch (cause) {
    console.error("Practice mode is not configured", cause);

    return NextResponse.json(
      { error: "Practice mode is not configured on the server." },
      { status: 500 },
    );
  }

  const { data: subjectRows, error: subjectError } = await admin
    .from("subjects")
    .select("id, name, code")
    .eq("code", code)
    .limit(1);

  if (subjectError) {
    console.error("Failed to load subject for practice", subjectError);

    return NextResponse.json(
      { error: "Could not load this subject. Please try again." },
      { status: 500 },
    );
  }

  const subject = (subjectRows?.[0] ?? null) as SubjectRow | null;

  if (!subject) {
    return NextResponse.json({ error: "Unknown subject." }, { status: 404 });
  }

  const { data: topicRows, error: topicError } = await admin
    .from("topics")
    .select("id, title")
    .eq("subject_id", subject.id);

  if (topicError) {
    console.error("Failed to load topics for practice", topicError);

    return NextResponse.json(
      { error: "Could not load this subject. Please try again." },
      { status: 500 },
    );
  }

  const topics = (topicRows ?? []) as TopicRow[];

  if (topics.length === 0) {
    return NextResponse.json(
      { error: "No topics are available for this subject yet." },
      { status: 404 },
    );
  }

  const { data: questionRows, error: questionError } = await admin
    .from("questions")
    .select(
      "id, topic_id, question_text, options, year, correct_option, explanation",
    )
    .in(
      "topic_id",
      topics.map((topic) => topic.id),
    )
    .order("id")
    .limit(MAX_SOURCE_QUESTIONS);

  if (questionError) {
    console.error("Failed to load practice questions", questionError);

    return NextResponse.json(
      { error: "Could not load this paper. Please try again." },
      { status: 500 },
    );
  }

  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));

  // Sample deterministically so a refresh (or an offline replay) shows the same
  // paper, while still varying by subject and count.
  const selected = shuffleWithSeed(
    (questionRows ?? []) as QuestionRow[],
    `practice:${code}:${count}`,
  ).slice(0, count);

  const answerKey: AnswerKey = {};
  const questions: ExamQuestion[] = [];

  for (const row of selected) {
    const options = parseOptions(row.options);
    const topicTitle = topicTitles.get(row.topic_id);

    if (!options || !topicTitle || !row.correct_option) {
      continue;
    }

    const correctOption = row.correct_option;

    if (!["A", "B", "C", "D"].includes(correctOption)) {
      continue;
    }

    questions.push({
      id: row.id,
      number: questions.length + 1,
      topicId: row.topic_id,
      topicTitle,
      text: row.question_text,
      options,
      year: row.year,
    });

    answerKey[row.id] = {
      correctOption: correctOption as AnswerKey[string]["correctOption"],
      explanation: row.explanation,
    };
  }

  if (questions.length === 0) {
    return NextResponse.json(
      { error: "No questions are available for this subject yet." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      paper: {
        mode: "practice" as const,
        subject,
        topics: topics.map((topic) => ({
          id: topic.id,
          title: topic.title,
          subjectId: subject.id,
        })),
        questions,
        answerKey,
        durationSeconds: 0,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
