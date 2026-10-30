import type { Metadata } from "next";
import { Suspense } from "react";

import { ExamSkeleton } from "@/components/exam/ExamRunner";
import ExamSessionShell from "@/components/exam/ExamSessionShell";
import { clampQuestionCount, parseExamMode } from "@/lib/exam/types";

export const metadata: Metadata = {
  title: "CBT Exam Session | PreJamb",
  description:
    "Simulation, untimed practice with instant explanations, or a subject-specific JAMB mock.",
};

type PageProps = {
  searchParams: Promise<{
    subject?: string;
    subjects?: string;
    mode?: string;
    count?: string;
  }>;
};

/**
 * Route entry point.
 *
 * The page is a thin shell: it only reads the query string and hands off to a
 * client component. All data loading happens on the client, so a hard browser
 * refresh while offline renders immediately from IndexedDB instead of failing
 * on a server-side fetch to Supabase.
 *
 * Supported query parameters:
 *   ?mode=simulation|practice|subject  (defaults to simulation)
 *   ?subjects=ENG,MTH,PHY              (simulation; comma-separated)
 *   ?subject=ENG                       (practice/subject; defaults to English)
 *   ?count=10                          (practice/subject only, clamped)
 */
export default function ExamSessionPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<ExamSkeleton />}>
      <ExamSessionContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ExamSessionContent({ searchParams }: PageProps) {
  const { subject, subjects, mode, count } = await searchParams;
  const requestedCodes = (subjects ?? subject ?? "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);

  return (
    <ExamSessionShell
      requestedCodes={requestedCodes}
      requestedMode={parseExamMode(mode)}
      requestedCount={clampQuestionCount(count, 10)}
    />
  );
}
