import type { Metadata } from "next";

import ExamSetup from "@/components/exam/ExamSetup";

export const metadata: Metadata = {
  title: "Choose an Exam Mode | PreJamb",
  description:
    "Pick a full timed JAMB simulation, untimed practice with instant explanations, or a subject-specific mock.",
};

/**
 * Mode selection entry point.
 *
 * Static shell: the subject list is hydrated on the client (IndexedDB first,
 * then Supabase) so the screen also opens from the service-worker cache.
 */
export default function ExamSetupPage() {
  return <ExamSetup />;
}
