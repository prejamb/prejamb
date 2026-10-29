import { NextResponse } from "next/server";

import { sanitizeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link / email-confirmation landing point.
 *
 * Supabase's PKCE flow redirects here with a one-time `code`. Exchanging it
 * writes the session cookies, after which the candidate is sent to `next`
 * (validated so it cannot become an open redirect).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));
  const callbackOrigin = resolveOrigin(request, origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, callbackOrigin));
    }
  }

  const failureUrl = new URL("/login", callbackOrigin);
  failureUrl.searchParams.set("error", "callback");
  failureUrl.searchParams.set("next", next);

  return NextResponse.redirect(failureUrl);
}

/**
 * Behind a proxy (Vercel, Fly, nginx) `request.url` can point at the internal
 * address, which would send the browser to a host it cannot reach.
 */
function resolveOrigin(request: Request, fallback: string): string {
  const forwardedHost = request.headers.get("x-forwarded-host");

  if (forwardedHost) {
    const forwardedProto =
      request.headers.get("x-forwarded-proto") ??
      (process.env.NODE_ENV === "development" ? "http" : "https");

    return `${forwardedProto}://${forwardedHost}`;
  }

  return fallback;
}
