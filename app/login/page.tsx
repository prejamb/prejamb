import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import LoginForm from "@/components/auth/LoginForm";
import { sanitizeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sign in | PreJamb",
  description:
    "Sign in to PreJamb to save your JAMB UTME practice scores and track your progress.",
};

type PageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default function LoginPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({ searchParams }: PageProps) {
  await connection();

  const params = await searchParams;
  const next = sanitizeNext(params.next);
  const initialError = params.error ?? null;

  // Already signed in: skip the form entirely.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(next);
  }

  return <LoginForm next={next} initialError={initialError} />;
}

function LoginSkeleton() {
  return (
    <div
      className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-auth px-4 py-12"
      aria-busy="true"
      aria-label="Loading sign-in"
    >
      <div className="w-full max-w-md">
        <div className="mx-auto size-14 animate-pulse rounded-2xl bg-slate-200" />
        <div className="mx-auto mt-5 h-7 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-7 h-[440px] animate-pulse rounded-3xl border border-slate-200 bg-white" />
      </div>
    </div>
  );
}
