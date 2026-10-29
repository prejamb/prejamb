import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "./env";

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Call this inside Server Components, Route Handlers and Server Actions. It
 * reads the auth session from the incoming cookies, so `auth.uid()` and RLS
 * policies work exactly as they do in the browser.
 *
 * `cookies()` is async in Next.js 15+, hence the `await` and the async
 * factory. Do not hoist the returned client into a module-level variable —
 * each request needs its own instance.
 *
 * Import this from server code only. Client Components must use
 * `lib/supabase/client.ts` instead.
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. `proxy.ts` refreshes the
          // session on every request, so ignoring this is safe — as long as
          // the proxy file is present.
        }
      },
    },
  });
}
