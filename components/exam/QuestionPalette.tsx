"use client";

import type { AnswerMap, FlaggedMap } from "@/lib/exam/types";
import { cn } from "@/lib/utils";

type QuestionPaletteProps = {
  /** Question ids in display order; the index is the question number - 1. */
  questionIds: string[];
  currentIndex: number;
  answers: AnswerMap;
  flagged: FlaggedMap;
  onSelect: (index: number) => void;
  className?: string;
};

type QuestionStatus = "unanswered" | "answered" | "flagged";

const STATUS_CLASS: Record<QuestionStatus, string> = {
  unanswered:
    "border-slate-300 bg-slate-200 text-slate-700 hover:bg-slate-300",
  answered:
    "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700",
  flagged:
    "border-purple-700 bg-purple-600 text-white hover:bg-purple-700",
};

const STATUS_LABEL: Record<QuestionStatus, string> = {
  unanswered: "unanswered",
  answered: "answered",
  flagged: "flagged for review",
};

export default function QuestionPalette({
  questionIds,
  currentIndex,
  answers,
  flagged,
  onSelect,
  className,
}: QuestionPaletteProps) {
  const total = questionIds.length;

  const answeredCount = questionIds.reduce(
    (count, questionId) => (answers[questionId] ? count + 1 : count),
    0,
  );

  const flaggedCount = questionIds.reduce(
    (count, questionId) => (flagged[questionId] ? count + 1 : count),
    0,
  );

  return (
    <section
      aria-label="Question palette"
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Question palette
        </h2>
        <p className="text-[11px] font-medium tabular-nums text-slate-500">
          {answeredCount}/{total} answered
        </p>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-2">
        {questionIds.map((questionId, index) => {
          const status: QuestionStatus = flagged[questionId]
            ? "flagged"
            : answers[questionId]
              ? "answered"
              : "unanswered";
          const isCurrent = index === currentIndex;
          const isAnswered = Boolean(answers[questionId]);

          return (
            <button
              key={questionId}
              type="button"
              onClick={() => onSelect(index)}
              aria-current={isCurrent ? "step" : undefined}
              aria-label={`Question ${index + 1}, ${STATUS_LABEL[status]}`}
              className={cn(
                "relative grid size-9 place-items-center rounded-md border text-xs font-semibold tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B1D6F] focus-visible:ring-offset-2",
                STATUS_CLASS[status],
                isCurrent && "ring-2 ring-[#4B1D6F] ring-offset-2",
              )}
            >
              {index + 1}

              {/* Flagged questions keep their purple state, but a dot shows
                  they have also been answered. */}
              {status === "flagged" && isAnswered ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 size-2.5 rounded-full border border-white bg-emerald-400"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <dl className="mt-4 grid gap-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-600">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3.5 rounded border border-slate-300 bg-slate-200"
          />
          <dt>Unanswered</dt>
          <dd className="ml-auto font-semibold tabular-nums text-slate-700">
            {total - answeredCount}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3.5 rounded border border-emerald-700 bg-emerald-600"
          />
          <dt>Answered</dt>
          <dd className="ml-auto font-semibold tabular-nums text-emerald-700">
            {answeredCount}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3.5 rounded border border-purple-700 bg-purple-600"
          />
          <dt>Flagged</dt>
          <dd className="ml-auto font-semibold tabular-nums text-purple-700">
            {flaggedCount}
          </dd>
        </div>
      </dl>
    </section>
  );
}
