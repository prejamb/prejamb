"use client";

import { ChevronLeft, ChevronRight, Flag } from "lucide-react";

import type { ExamQuestion, OptionLabel } from "@/lib/exam/types";
import { cn } from "@/lib/utils";

type QuestionCardProps = {
  question: ExamQuestion;
  totalQuestions: number;
  selected: OptionLabel | null;
  isFlagged: boolean;
  onSelect: (label: OptionLabel) => void;
  onToggleFlag: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

const NAV_BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

export default function QuestionCard({
  question,
  totalQuestions,
  selected,
  isFlagged,
  onSelect,
  onToggleFlag,
  onPrevious,
  onNext,
}: QuestionCardProps) {
  const isFirst = question.number <= 1;
  const isLast = question.number >= totalQuestions;

  return (
    <section
      aria-labelledby="question-heading"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="question-heading"
            className="rounded-md bg-[#4B1D6F] px-2.5 py-1 text-xs font-semibold text-white"
          >
            Question {question.number} of {totalQuestions}
          </h2>
          <span className="rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
            {question.topicTitle}
          </span>
          {question.year ? (
            <span className="rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
              UTME {question.year}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onToggleFlag}
          aria-pressed={isFlagged}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B1D6F] focus-visible:ring-offset-2",
            isFlagged
              ? "border-purple-300 bg-purple-50 text-purple-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100",
          )}
        >
          <Flag
            className={cn(
              "size-3.5",
              isFlagged && "fill-purple-600 text-purple-600",
            )}
            aria-hidden="true"
          />
          {isFlagged ? "Flagged for review" : "Flag for review"}
        </button>
      </header>

      <div className="px-4 py-5 sm:px-5">
        <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-900">
          {question.text}
        </p>

        <fieldset className="mt-5">
          <legend className="sr-only">
            Select one answer for question {question.number}
          </legend>

          <div className="grid gap-2.5">
            {question.options.map((option) => {
              const isSelected = selected === option.label;

              return (
                <label
                  key={option.label}
                  className={cn(
                    "group flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors",
                    "focus-within:ring-2 focus-within:ring-[#4B1D6F] focus-within:ring-offset-1",
                    isSelected
                      ? "border-[#4B1D6F] bg-[#4B1D6F]/5"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <input
                    type="radio"
                    name={`question-${question.id}`}
                    value={option.label}
                    checked={isSelected}
                    onChange={() => onSelect(option.label)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold",
                      isSelected
                        ? "border-[#4B1D6F] bg-[#4B1D6F] text-white"
                        : "border-slate-300 bg-white text-slate-600 group-hover:border-slate-400",
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="text-sm leading-6 text-slate-800">
                    {option.text}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onPrevious}
          disabled={isFirst}
          className={cn(
            NAV_BUTTON,
            "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400",
          )}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Previous
        </button>

        <p className="order-last w-full text-center text-[11px] font-medium text-slate-500 sm:order-none sm:w-auto">
          {selected ? (
            <>
              Selected:{" "}
              <span className="font-bold text-[#4B1D6F]">{selected}</span>
            </>
          ) : (
            "No option selected"
          )}
        </p>

        <button
          type="button"
          onClick={onNext}
          disabled={isLast}
          className={cn(
            NAV_BUTTON,
            "bg-[#0B7A3B] text-white hover:bg-[#096430] focus-visible:ring-emerald-500",
          )}
        >
          Next
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}
