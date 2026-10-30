import { NextResponse } from "next/server";

import { EXAM_DURATION_SECONDS, isOptionLabel } from "@/lib/exam/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MAX_QUESTIONS = 200;
const MAX_SUBJECTS = 10;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QuestionRow = {
  id: string;
  topic_id: string;
  correct_option: string;
};

type TopicScore = { correct: number; total: number };

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Grades a submitted exam and persists the attempt.
 *
 * The client only ever sends question ids and chosen labels — the answer key
 * is read here with the service-role client, which is the only role allowed to
 * see `questions.correct_option` (see supabase/schema.sql). A tampered payload
 * can therefore only change which options were chosen, never the score.
 *
 * Guests are graded too, but the attempt is not written, so the practice mode
 * works before auth screens land.
 */
export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  if (typeof payload !== "object" || payload === null) {
    return badRequest("Invalid request body.");
  }

  const body = payload as Record<string, unknown>;

  // Multi-subject simulations send every subject in the paper. Older queued
  // attempts only carry `subjectId`, so accept both shapes.
  const rawSubjectIds = Array.isArray(body.subjectIds)
    ? body.subjectIds.filter(
        (id): id is string => typeof id === "string" && UUID_PATTERN.test(id),
      )
    : [];
  const singleSubjectId =
    typeof body.subjectId === "string" ? body.subjectId : "";

  const subjectIds = [
    ...new Set(
      (rawSubjectIds.length > 0 ? rawSubjectIds : [singleSubjectId]).filter(
        (id) => UUID_PATTERN.test(id),
      ),
    ),
  ].slice(0, MAX_SUBJECTS);

  if (subjectIds.length === 0) {
    return badRequest("At least one valid subject is required.");
  }

  const rawQuestionIds = Array.isArray(body.questionIds)
    ? body.questionIds.filter(
        (id): id is string => typeof id === "string" && UUID_PATTERN.test(id),
      )
    : [];

  const questionIds = [...new Set(rawQuestionIds)].slice(0, MAX_QUESTIONS);

  if (questionIds.length === 0) {
    return badRequest("No valid questions were submitted.");
  }

  const rawAnswers =
    typeof body.answers === "object" && body.answers !== null
      ? (body.answers as Record<string, unknown>)
      : {};

  const answers: Record<string, string> = {};

  for (const questionId of questionIds) {
    const label = rawAnswers[questionId];

    if (isOptionLabel(label)) {
      answers[questionId] = label;
    }
  }

  const rawTime =
    typeof body.timeSpentSeconds === "number" &&
    Number.isFinite(body.timeSpentSeconds)
      ? body.timeSpentSeconds
      : 0;

  const timeSpentSeconds = Math.min(
    EXAM_DURATION_SECONDS,
    Math.max(0, Math.round(rawTime)),
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let admin: ReturnType<typeof createAdminClient>;

  try {
    admin = createAdminClient();
  } catch (cause) {
    console.error("Exam grading is not configured", cause);

    return NextResponse.json(
      { error: "Exam submission is not configured on the server." },
      { status: 500 },
    );
  }

  // Restrict grading to questions that really belong to the requested
  // subjects, so a crafted payload cannot mix in questions from other papers.
  const { data: topicRows, error: topicsError } = await admin
    .from("topics")
    .select("id")
    .in("subject_id", subjectIds);

  if (topicsError) {
    console.error("Failed to load topics for grading", topicsError);

    return NextResponse.json(
      { error: "Could not grade this exam. Please try again." },
      { status: 500 },
    );
  }

  const topicIds = (topicRows ?? []).map((topic) => topic.id as string);

  if (topicIds.length === 0) {
    return badRequest("Unknown subject.");
  }

  const { data: questionRows, error: questionsError } = await admin
    .from("questions")
    .select("id, topic_id, correct_option")
    .in("id", questionIds)
    .in("topic_id", topicIds);

  if (questionsError) {
    console.error("Failed to load answer key", questionsError);

    return NextResponse.json(
      { error: "Could not grade this exam. Please try again." },
      { status: 500 },
    );
  }

  const questionById = new Map<string, QuestionRow>(
    ((questionRows ?? []) as QuestionRow[]).map((row) => [row.id, row]),
  );

  const gradedIds = questionIds.filter((id) => questionById.has(id));

  if (gradedIds.length === 0) {
    return badRequest(
      "None of the submitted questions belong to the selected subjects.",
    );
  }

  let score = 0;
  const topicBreakdown: Record<string, TopicScore> = {};

  for (const questionId of gradedIds) {
    const question = questionById.get(questionId);

    if (!question) {
      continue;
    }

    const stats = (topicBreakdown[question.topic_id] ??= {
      correct: 0,
      total: 0,
    });

    stats.total += 1;

    if (answers[questionId] === question.correct_option) {
      stats.correct += 1;
      score += 1;
    }
  }

  const totalQuestions = gradedIds.length;
  const percentage = Math.round((score / totalQuestions) * 100);

  let saved = false;
  let attemptId: string | null = null;
  let message: string | undefined;

  if (user) {
    const { data: attemptRow, error: attemptError } = await admin
      .from("exam_attempts")
      .insert({
        user_id: user.id,
        score,
        total_questions: totalQuestions,
        time_spent_seconds: timeSpentSeconds,
        topic_breakdown: topicBreakdown,
      })
      .select("id")
      .single();

    if (attemptError || !attemptRow) {
      // Never discard a graded result just because persistence failed.
      console.error("Failed to save exam attempt", attemptError);
      message =
        "Your score was graded but could not be saved. Please try again later.";
    } else {
      const newAttemptId = attemptRow.id as string;
      attemptId = newAttemptId;
      saved = true;

      // Snapshot what the candidate picked so the diagnostic report can show
      // a question-by-question review. Unanswered questions are stored with a
      // null selection rather than omitted.
      const answerRows = gradedIds.map((questionId, index) => {
        const question = questionById.get(questionId);
        const selectedOption = answers[questionId] ?? null;

        return {
          attempt_id: newAttemptId,
          question_id: questionId,
          position: index,
          selected_option: selectedOption,
          is_correct: Boolean(
            question && selectedOption === question.correct_option,
          ),
        };
      });

      const { error: answersError } = await admin
        .from("exam_attempt_answers")
        .insert(answerRows);

      if (answersError) {
        // The score is still valid and saved; only the deep review is missing.
        console.error("Failed to save attempt answers", answersError);
        message =
          "Your score was saved, but the detailed review could not be stored.";
      }
    }
  } else {
    message = "Sign in to save your score and track your progress.";
  }

  return NextResponse.json({
    result: {
      score,
      totalQuestions,
      percentage,
      timeSpentSeconds,
      topicBreakdown,
      saved,
      attemptId,
      ...(message ? { message } : {}),
    },
  });
}
