/**
 * Centralised Supabase environment access.
 *
 * NEXT_PUBLIC_* variables are inlined by Next.js at build time, so they must be
 * referenced statically (never via a dynamic key) for the browser bundle to
 * pick them up.
 */

const MISSING_ENV_MESSAGE =
  "Missing Supabase environment variables. Add NEXT_PUBLIC_SUPABASE_URL and " +
  "NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local (see .env.local.example) and " +
  "restart the dev server.";

export type SupabasePublicEnv = {
  url: string;
  anonKey: string;
};

/** Reads and validates the public Supabase credentials. */
export function getSupabaseEnv(): SupabasePublicEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(MISSING_ENV_MESSAGE);
  }

  return { url, anonKey };
}

/**
 * Reads the service-role key. Server-only — never import this into a Client
 * Component or anywhere that ends up in the browser bundle.
 */
export function getSupabaseServiceRoleKey(): string {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local and restart the " +
        "dev server. This key bypasses Row Level Security — keep it server-side.",
    );
  }

  return serviceRoleKey;
}
