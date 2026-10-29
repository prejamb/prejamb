"use client";

import { ArrowRight, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "password" | "magic";
type Status = "idle" | "loading";

type LoginFormProps = {
  /** Validated same-origin path to open after a successful sign-in. */
  next: string;
  /** Raw `?error=` value from the auth callback, when present. */
  initialError?: string | null;
};

const METHODS: Array<{ key: Mode; label: string }> = [
  { key: "password", label: "Password" },
  { key: "magic", label: "Magic link" },
];

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }

  if (lower.includes("email not confirmed")) {
    return "Please confirm your email address before signing in.";
  }

  if (lower.includes("user already registered")) {
    return "An account with this email already exists. Sign in instead.";
  }

  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Wait a minute, then try again.";
  }

  if (lower.includes("password should be")) {
    return "Choose a stronger password (at least 6 characters).";
  }

  return message;
}

function buildCallbackUrl(next: string): string {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export default function LoginForm({ next, initialError }: LoginFormProps) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("password");
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(() => {
    if (initialError === "callback") {
      return "That sign-in link is invalid or has expired. Request a new one.";
    }

    return initialError
      ? "We could not complete that sign-in. Please try again."
      : null;
  });
  const [notice, setNotice] = useState<string | null>(null);

  const isLoading = status === "loading";

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const cleanEmail = email.trim().toLowerCase();

    if (!isEmail(cleanEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    if (mode === "password" && password.length < 6) {
      setError("Your password must be at least 6 characters.");
      return;
    }

    setStatus("loading");

    try {
      const supabase = createClient();

      if (mode === "magic") {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: cleanEmail,
          options: {
            emailRedirectTo: buildCallbackUrl(next),
            shouldCreateUser: true,
          },
        });

        if (otpError) {
          throw otpError;
        }

        setNotice(`Check your inbox — we sent a sign-in link to ${cleanEmail}.`);
        setStatus("idle");
        return;
      }

      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: buildCallbackUrl(next) },
        });

        if (signUpError) {
          throw signUpError;
        }

        // When email confirmation is disabled Supabase returns a session and
        // we can continue straight away. Otherwise, ask for confirmation.
        if (data.session) {
          router.replace(next);
          router.refresh();
          return;
        }

        setNotice(
          "Account created. Check your email to confirm it, then sign in.",
        );
        setIsSignUp(false);
        setStatus("idle");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      // Keep the spinner up while the server re-renders with the new session.
      router.replace(next);
      router.refresh();
      return;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Something went wrong. Please try again.";

      setError(friendlyAuthError(message));
      setStatus("idle");
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-gradient-to-b from-slate-100 to-white px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#4B1D6F] text-white shadow-lg shadow-purple-900/20">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
            {isSignUp && mode === "password"
              ? "Create your account"
              : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Sign in to save your scores and track your progress.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 sm:p-6">
          <div
            className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
            role="group"
            aria-label="Sign-in method"
          >
            {METHODS.map((method) => {
              const isActive = mode === method.key;

              return (
                <button
                  key={method.key}
                  type="button"
                  onClick={() => switchMode(method.key)}
                  aria-pressed={isActive}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B1D6F] focus-visible:ring-offset-2",
                    isActive
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {method.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <div>
              <label
                htmlFor="login-email"
                className="mb-1.5 block text-xs font-semibold text-slate-700"
              >
                Email address
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#4B1D6F] focus:ring-2 focus:ring-[#4B1D6F]/20"
                />
              </div>
            </div>

            {mode === "password" ? (
              <div>
                <label
                  htmlFor="login-password"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="login-password"
                    type="password"
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={isSignUp ? "At least 6 characters" : "Your password"}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#4B1D6F] focus:ring-2 focus:ring-[#4B1D6F]/20"
                  />
                </div>
              </div>
            ) : (
              <p className="text-[11px] leading-5 text-slate-500">
                No password needed. We&apos;ll email you a one-time link that
                signs you in on this device.
              </p>
            )}

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"
              >
                {error}
              </p>
            ) : null}

            {notice ? (
              <p
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800"
              >
                {notice}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#4B1D6F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3d175b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B1D6F] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : mode === "magic" ? (
                <Mail className="size-4" aria-hidden="true" />
              ) : (
                <ArrowRight className="size-4" aria-hidden="true" />
              )}
              {isLoading
                ? "Please wait…"
                : mode === "magic"
                  ? "Email me a sign-in link"
                  : isSignUp
                    ? "Create account"
                    : "Sign in"}
            </button>

            {mode === "password" ? (
              <p className="text-center text-xs text-slate-600">
                {isSignUp ? "Already have an account?" : "New to PreJamb?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp((value) => !value);
                    setError(null);
                    setNotice(null);
                  }}
                  className="font-semibold text-[#4B1D6F] underline-offset-2 hover:underline"
                >
                  {isSignUp ? "Sign in" : "Create an account"}
                </button>
              </p>
            ) : null}
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              or
            </span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <Link
            href="/exam/session"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
          >
            Continue as guest
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <p className="mt-2 text-center text-[11px] leading-5 text-slate-500">
            Guest attempts are graded instantly but are not saved to your
            account.
          </p>
        </div>
      </div>
    </div>
  );
}
