import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv, getSupabaseServiceRoleKey } from "./env";

/**
 * Privileged server-side client using the service-role key.
 *
 * This bypasses Row Level Security. Use it only for trusted server work:
 *   - grading answers (reading `questions.correct_option` and `explanation`,
 *     which are hidden from `anon` / `authenticated`)
 *   - writing the question bank or syllabus content
 *   - admin/reporting queries
 *
 * Never import this from a Client Component, and never expose the key via a
 * NEXT_PUBLIC_ variable. There is deliberately no singleton here so that a
 * long-lived module cache can never leak the client across requests.
 */
export function createAdminClient(): SupabaseClient {
  const { url } = getSupabaseEnv();

  return createClient(url, getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
