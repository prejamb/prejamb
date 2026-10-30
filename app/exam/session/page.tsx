import type { Metadata } from "next";
import { Suspense } from "react";

import { ExamSkeleton } from "@/components/exam/ExamRunner";
import ExamSessionShell from "@/components/exam/ExamSessionShell";

export const metadata: Metadata = {
  title: "CBT Exam Session | PreJamb",
  description:
    "Timed JAMB UTME practice with a question palette, flagging and instant scoring.",
};

type PageProps = {
  searchParams: Promise<{ subject?: string }>;
};

/**
 * Route entry point.
 *
 * The page is a thin shell: it only reads `?subject=` and hands off to a client
 * component. All data loading happens on the client, so a hard browser refresh
 * while offline renders immediately from IndexedDB instead of failing on a
 * server-side fetch to Supabase.
 */
export default function ExamSessionPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<ExamSkeleton />}>
      <ExamSessionContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ExamSessionContent({ searchParams }: PageProps) {
  const { subject } = await searchParams;

  return <ExamSessionShell requestedCode={subject ?? null} />;
}
