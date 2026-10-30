"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  Lightbulb,
  XCircle,
} from "lucide-react";

import type {
  AnswerKey,
  ExamMode,
  ExamQuestion,
  OptionLabel,
} from "@/lib/exam/types";
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
  /** Practice mode reveals the key as soon as an option is picked. */
  mode: ExamMode;
  answerKey?: AnswerKey;
  /** Practice questions lock once answered so the answer cannot be flipped. */
  locked?: boolean;
};

const NAV_BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold " +
  "transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
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
  mode,
  answerKey,
  locked = false,
}: QuestionCardProps) {
  const isFirst = question.number <= 1;
  const isLast = question.number >= totalQuestions;

  const key = answerKey?.[question.id] ?? null;
  const isPractice = mode === "practice";
  const revealed = isPractice && Boolean(selected) && Boolean(key);
  const isCorrect = revealed && key ? selected === key.correctOption : false;
  const isLocked = locked || revealed;

  return (
    <section
      aria-labelledby="question-heading"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="question-heading"
            className="inline-flex items-center rounded-lg bg-gradient-to-b from-primary-600 to-primary-700 px-3 py-1 text-xs font-semibold text-white shadow-sm shadow-primary-600/30"
          >
            Question {question.number} of {totalQuestions}
          </h2>
          <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
            {question.topicTitle}
          </span>
          {question.year ? (
            <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
              UTME {question.year}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onToggleFlag}
          aria-pressed={isFlagged}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
            isFlagged
              ? "border-amber-300 bg-amber-50 text-amber-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
          )}
        >
          <Flag
            className={cn(
              "size-3.5",
              isFlagged && "fill-amber-500 text-amber-600",
            )}
            aria-hidden="true"
          />
          {isFlagged ? "Flagged for review" : "Flag for review"}
        </button>
      </header>

      <div className="px-4 py-5 sm:px-6">
        <p className="whitespace-pre-wrap text-[15px] font-medium leading-7 text-slate-800">
          {question.text}
        </p>

        <fieldset className="mt-6">
          <legend className="sr-only">
            Select one answer for question {question.number}
          </legend>

          <div className="grid gap-2.5">
            {question.options.map((option) => {
              const isSelected = selected === option.label;
              const isAnswer = revealed && key?.correctOption === option.label;
              const isWrongPick =
                revealed && isSelected && key?.correctOption !== option.label;
              const isMuted = revealed && !isAnswer && !isWrongPick;

              return (
                <label
                  key={option.label}
                  className={cn(
                    "group flex items-center gap-3.5 rounded-xl border px-4 py-3.5 transition-all",
                    "focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2",
                    isAnswer
                      ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-500/25"
                      : isWrongPick
                        ? "border-red-400 bg-red-50/60 ring-2 ring-red-400/25"
                        : isSelected
                          ? "border-primary-500 bg-primary-50/50 ring-2 ring-primary-500/30"
                          : isMuted
                            ? "border-slate-200 bg-white opacity-60"
                            : "border-slate-200 bg-white hover:border-primary-200 hover:bg-primary-50/30",
                    isLocked && !isAnswer && !isWrongPick
                      ? "cursor-default"
                      : "cursor-pointer",
                  )}
                >
                  <input
                    type="radio"
                    name={`question-${question.id}`}
                    value={option.label}
                    checked={isSelected}
                    disabled={isLocked}
                    onChange={() => onSelect(option.label)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold transition-all",
                      isAnswer
                        ? "border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/40"
                        : isWrongPick
                          ? "border-red-500 bg-red-500 text-white shadow-sm shadow-red-500/40"
                          : isSelected
                            ? "border-primary-600 bg-primary-600 text-white shadow-sm shadow-primary-600/40"
                            : "border-slate-300 bg-white text-slate-500 group-hover:border-primary-300",
                    )}
                  >
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-sm leading-6",
                      isAnswer
                        ? "font-semibold text-emerald-900"
                        : isWrongPick
                          ? "font-medium text-red-900"
                          : isSelected
                            ? "font-medium text-slate-900"
                            : "text-slate-700",
                    )}
                  >
                    {option.text}
                  </span>

                  {isAnswer ? (
                    <CheckCircle2
                      className="size-5 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                  ) : null}
                  {isWrongPick ? (
                    <XCircle
                      className="size-5 shrink-0 text-red-500"
                      aria-hidden="true"
                    />
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>

        {revealed && key ? (
          <div
            aria-live="polite"
            className={cn(
              "mt-5 rounded-xl border p-4",
              isCorrect
                ? "border-emerald-200 bg-emerald-50/70"
                : "border-red-200 bg-red-50/50",
            )}
          >
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide",
                isCorrect ? "text-emerald-700" : "text-red-700",
              )}
            >
              {isCorrect ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : (
                <XCircle className="size-4" aria-hidden="true" />
              )}
              {isCorrect
                ? "Correct"
                : `Incorrect — the answer is ${key.correctOption}`}
            </p>

            <div className="mt-2 flex items-start gap-2 border-t border-slate-900/5 pt-2">
              <Lightbulb
                className="mt-1 size-4 shrink-0 text-amber-500"
                aria-hidden="true"
              />
              <p className="text-sm leading-6 text-slate-700">
                {key.explanation?.trim() ||
                  "No explanation has been added for this question yet."}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={onPrevious}
          disabled={isFirst}
          className={cn(
            NAV_BUTTON,
            "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400",
          )}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Previous
        </button>

        <p className="order-last w-full text-center text-[11px] font-medium text-slate-500 sm:order-none sm:w-auto">
          {revealed && key ? (
            isCorrect ? (
              <>
                Correct — <span className="font-bold text-emerald-700">+1</span>
              </>
            ) : (
              <>
                Marked wrong — answer{" "}
                <span className="font-bold text-red-600">
                  {key.correctOption}
                </span>
              </>
            )
          ) : selected ? (
            isPractice ? (
              <>
                Selected:{" "}
                <span className="font-bold text-primary-700">{selected}</span>
              </>
            ) : (
              <>
                Selected:{" "}
                <span className="font-bold text-primary-700">{selected}</span>
              </>
            )
          ) : isPractice ? (
            "Choose an option to reveal the answer"
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
            "bg-gradient-to-b from-primary-600 to-primary-700 text-white shadow-sm shadow-primary-600/30 hover:from-primary-500 hover:to-primary-700 focus-visible:ring-primary-500",
          )}
        >
          Next
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}
