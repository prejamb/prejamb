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
  await supabase.auth.getUser();

  // Add route guards here, e.g.:
  //   const { data: { user } } = await supabase.auth.getUser();
  //   if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
  //     const redirectUrl = request.nextUrl.clone();
  //     redirectUrl.pathname = "/login";
  //     redirectUrl.searchParams.set("next", request.nextUrl.pathname);
  //     return NextResponse.redirect(redirectUrl);
  //   }

  return response;
}

export const config = {
  // Run on everything except Next.js internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
