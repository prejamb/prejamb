"use client";

import { Loader2, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type NavbarUser = {
  email: string | null;
  name: string;
  avatarUrl: string | null;
};

const LINKS = [
  { href: "/exam/session", label: "Practice" },
  { href: "/exam/results", label: "My Results" },
];

function getInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "PJ";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

function Avatar({
  user,
  className,
}: {
  user: NavbarUser;
  className?: string;
}) {
  if (user.avatarUrl) {
    return (
      // Provider avatars (Google, GitHub, …) live on arbitrary hosts, so a
      // plain <img> avoids configuring next/image remotePatterns per provider.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        width={32}
        height={32}
        referrerPolicy="no-referrer"
        className={cn(
          "size-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200",
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-[#4B1D6F] text-[11px] font-bold text-white",
        className,
      )}
    >
      {getInitials(user.name)}
    </span>
  );
}

export default function NavbarClient({ user }: { user: NavbarUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // Never bounce a signed-in user back to /login (it would loop).
  const signInHref = pathname.startsWith("/login")
    ? "/login"
    : `/login?next=${encodeURIComponent(pathname)}`;

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await createClient().auth.signOut();
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="relative z-40 border-b border-slate-200 bg-white">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/"
            aria-label="PreJamb home"
            className="flex shrink-0 items-center gap-2"
          >
            <span className="grid size-9 place-items-center rounded-lg bg-[#4B1D6F] text-xs font-bold tracking-wide text-white">
              PJ
            </span>
            <span className="text-base font-bold tracking-tight text-slate-900">
              Pre<span className="text-[#0B7A3B]">Jamb</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive(link.href)
                    ? "bg-purple-50 text-[#4B1D6F]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {user ? (
            <>
              <div className="hidden items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 md:flex">
                <Avatar user={user} />
                <div className="min-w-0 max-w-[150px]">
                  <p className="truncate text-xs font-semibold leading-tight text-slate-900">
                    {user.name}
                  </p>
                  {user.email ? (
                    <p className="truncate text-[10px] leading-tight text-slate-500">
                      {user.email}
                    </p>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                aria-label="Sign out"
                title="Sign out"
                className="hidden size-9 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B1D6F] disabled:opacity-50 md:grid"
              >
                {signingOut ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut className="size-4" aria-hidden="true" />
                )}
              </button>
            </>
          ) : (
            <Link
              href={signInHref}
              className="hidden rounded-md bg-[#4B1D6F] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3d175b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B1D6F] focus-visible:ring-offset-2 md:inline-flex"
            >
              Sign In
            </Link>
          )}

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid size-9 place-items-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B1D6F] md:hidden"
          >
            {open ? (
              <X className="size-5" aria-hidden="true" />
            ) : (
              <Menu className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </nav>

      {open ? (
        <div
          id="mobile-navigation"
          className="border-t border-slate-200 bg-white md:hidden"
        >
          <div className="mx-auto max-w-7xl space-y-3 px-4 py-3 sm:px-6">
            <div className="flex flex-col gap-0.5">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive(link.href)
                      ? "bg-purple-50 text-[#4B1D6F]"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-3">
              {user ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar user={user} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {user.name}
                      </p>
                      {user.email ? (
                        <p className="truncate text-xs text-slate-500">
                          {user.email}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    <LogOut className="size-3.5" aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              ) : (
                <Link
                  href={signInHref}
                  onClick={() => setOpen(false)}
                  className="inline-flex w-full items-center justify-center rounded-md bg-[#4B1D6F] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3d175b]"
                >
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
