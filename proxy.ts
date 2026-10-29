import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Next.js 16 `proxy` file (the replacement for `middleware.ts`).
 *
 * Its single job is to keep the Supabase auth cookies fresh: Server Components
 * cannot write cookies, so without this refresh tokens would silently expire
 * and server-side queries would start failing as `anon`.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Revalidate the token with Supabase Auth on every request. Use getUser(),
  // not getSession(): the latter only decodes the cookie and does not verify it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Results history and individual reports belong to a candidate. The pages
  // also check the session, but redirecting here avoids rendering them at all.
  const { pathname, search } = request.nextUrl;
  const isProtected =
    pathname === "/exam/results" || pathname.startsWith("/exam/results/");

  if (!user && isProtected) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", `${pathname}${search}`);

    const redirectResponse = NextResponse.redirect(redirectUrl);

    // A redirect response is a fresh object: carry over any cookies that the
    // Supabase client refreshed above, otherwise the new session is lost.
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
  }

  return response;
}

export const config = {
  // Run on everything except Next.js internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
