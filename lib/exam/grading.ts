/**
 * Client-safe grading.
 *
 * Simulation and subject mocks are graded on the server, because the answer key
 * never leaves it. Practice mode is different: the candidate sees the answer the
 * moment they pick an option, so the key is already on the device. This module
 * turns that key into a score so practice results are instant — and still work
 * with no connection.
 */

import type {
  AnswerKey,
  AnswerMap,
  ExamQuestion,
  TopicScore,
} from "./types";

export type GradedPaper = {
  score: number;
  totalQuestions: number;
  percentage: number;
  topicBreakdown: Record<string, TopicScore>;
};

export function gradePaper(
  questions: readonly ExamQuestion[],
  answers: AnswerMap,
  answerKey: AnswerKey,
): GradedPaper {
  let score = 0;
  let totalQuestions = 0;

  const topicBreakdown: Record<string, TopicScore> = {};

  for (const question of questions) {
    const key = answerKey[question.id];

    // Questions without a key cannot be graded; the server skips them too.
    if (!key) {
      continue;
    }

    const stats = (topicBreakdown[question.topicId] ??= {
      correct: 0,
      total: 0,
    });

    stats.total += 1;
    totalQuestions += 1;

    if (answers[question.id] === key.correctOption) {
      stats.correct += 1;
      score += 1;
    }
  }

  return {
    score,
    totalQuestions,
    percentage:
      totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0,
    topicBreakdown,
  };
}
