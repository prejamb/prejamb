import { connection } from "next/server";

import { createClient } from "@/lib/supabase/server";

import NavbarClient, { type NavbarUser } from "./NavbarClient";

/**
 * Server-rendered navigation bar.
 *
 * The user is resolved during the request (cookies), so the first paint already
 * shows the correct avatar or "Sign In" button — no client-side flash. It is
 * async because `cookies()` is async in Next.js 15+.
 *
 * Wrap this component in <Suspense> in the layout: with Cache Components
 * enabled, dynamic cookie reads must be streamed.
 */
export default async function Navbar() {
  // Supabase's auth client reads the clock while initialising. With Cache
  // Components that is only allowed after this boundary is marked dynamic.
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let navbarUser: NavbarUser | null = null;

  if (user) {
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const email = user.email ?? null;
    const fullName =
      readString(metadata, "full_name") ?? readString(metadata, "name");

    navbarUser = {
      email,
      name: fullName ?? email?.split("@")[0] ?? "Candidate",
      avatarUrl:
        readString(metadata, "avatar_url") ?? readString(metadata, "picture"),
    };
  }

  return <NavbarClient user={navbarUser} />;
}

function readString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
