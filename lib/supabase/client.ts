"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "./env";

/**
 * Browser-side Supabase client.
 *
 * Uses cookies (not localStorage) so the session is shared with Server
 * Components, Route Handlers and `proxy.ts`. The instance is a module-level
 * singleton: creating a new client on every render would open extra auth
 * listeners and refresh timers.
 *
 * Import this from Client Components and client-side hooks only.
 */
let browserClient: SupabaseClient | undefined;

export function createClient(): SupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = getSupabaseEnv();
  browserClient = createBrowserClient(url, anonKey);

  return browserClient;
}
