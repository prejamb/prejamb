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
    "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
  answered:
    "border-emerald-600 bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm shadow-emerald-500/30",
  flagged:
    "border-amber-500 bg-amber-400 text-amber-950 hover:bg-amber-500 shadow-sm shadow-amber-500/30",
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
        "rounded-2xl border border-slate-200 bg-white p-4 shadow-card",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Question palette
        </h2>
        <p className="text-[11px] font-semibold tabular-nums text-slate-500">
          {answeredCount}/{total} answered
        </p>
      </div>

      <div className="mt-3.5 grid grid-cols-5 gap-2">
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
                "relative grid size-9 place-items-center rounded-lg border text-xs font-semibold tabular-nums transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
                STATUS_CLASS[status],
                isCurrent &&
                  "ring-2 ring-primary-600 ring-offset-2 ring-offset-white",
              )}
            >
              {index + 1}

              {/* Flagged questions keep their amber state, but a dot shows
                  they have also been answered. */}
              {status === "flagged" && isAnswered ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-white bg-emerald-500"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <dl className="mt-4 grid gap-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-600">
        <LegendRow
          swatch="border border-slate-200 bg-white"
          label="Unanswered"
          value={total - answeredCount}
          valueClass="text-slate-700"
        />
        <LegendRow
          swatch="border border-emerald-600 bg-emerald-500"
          label="Answered"
          value={answeredCount}
          valueClass="text-emerald-700"
        />
        <LegendRow
          swatch="border border-amber-500 bg-amber-400"
          label="Flagged"
          value={flaggedCount}
          valueClass="text-amber-700"
        />
      </dl>
    </section>
  );
}

function LegendRow({
  swatch,
  label,
  value,
  valueClass,
}: {
  swatch: string;
  label: string;
  value: number;
  valueClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className={cn("size-3.5 rounded", swatch)} />
      <dt>{label}</dt>
      <dd className={cn("ml-auto font-semibold tabular-nums", valueClass)}>
        {value}
      </dd>
    </div>
  );
}
