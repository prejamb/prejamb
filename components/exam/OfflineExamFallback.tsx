"use client";

import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import ExamRunner, { ExamSkeleton } from "@/components/exam/ExamRunner";
import {
  getCachedQuestionSet,
  getQuestionSetCacheKey,
  listCachedQuestionSets,
  type CachedQuestionSet,
} from "@/lib/db/indexeddb";
import { useNetworkStatus } from "@/lib/hooks/useNetworkStatus";
import { createClient } from "@/lib/supabase/client";

type OfflineExamFallbackProps = {
  requestedCode: string | null;
};

/**
 * Rendered by the exam route when Supabase cannot be reached. It transparently
 * serves a previously downloaded paper from IndexedDB instead of failing, so a
 * candidate with no connection can still sit a full practice exam.
 */
export default function OfflineExamFallback({
  requestedCode,
}: OfflineExamFallbackProps) {
  const { online } = useNetworkStatus();
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const [cached, setCached] = useState<CachedQuestionSet | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [candidateName, setCandidateName] = useState("Guest candidate");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let set = requestedCode
        ? await getCachedQuestionSet(
            getQuestionSetCacheKey(requestedCode),
          ).catch(() => null)
        : null;

      // Fall back to the most recently downloaded paper.
      if (!set) {
        const all = await listCachedQuestionSets().catch(() => []);
        all.sort((a, b) => b.fetchedAt - a.fetchedAt);
        set = all[0] ?? null;
      }

      // Resolve identity from the locally stored session (no network round
      // trip) so progress and submissions stay tied to the right account.
      let userId: string | null = null;
      let name = "Guest candidate";

      try {
        const { data } = await createClient().auth.getSession();
        const sessionUser = data.session?.user ?? null;

        if (sessionUser) {
          userId = sessionUser.id;
          const metadata = (sessionUser.user_metadata ?? {}) as Record<
            string,
            unknown
          >;
          const fullName =
            typeof metadata.full_name === "string" &&
            metadata.full_name.trim().length > 0
              ? metadata.full_name.trim()
              : "";

          name = fullName || sessionUser.email?.split("@")[0] || "Candidate";
        }
      } catch {
        // Treat as a guest; the paper is still usable.
      }

      if (cancelled) {
        return;
      }

      if (set) {
        setCached(set);
        setSessionId(`${set.subject.code}:${userId ?? "guest"}`);
        setCandidateName(name);
        setIsAuthenticated(Boolean(userId));
        setState("ready");
      } else {
        setState("empty");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedCode]);

  if (state === "loading") {
    return <ExamSkeleton />;
  }

  if (state === "empty" || !cached) {
    return <OfflineEmpty online={online} />;
  }

  return (
    <div>
      {online ? null : (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900">
          You are offline — showing the paper downloaded earlier. Your answers
          will be saved and submitted when you reconnect.
        </div>
      )}

      <ExamRunner
        subject={cached.subject}
        questions={cached.questions}
        sessionId={sessionId}
        guestSessionId={`${cached.subject.code}:guest`}
        candidateName={candidateName}
        isAuthenticated={isAuthenticated}
      />
    </div>
  );
}

function OfflineEmpty({ online }: { online: boolean }) {
  const Icon = online ? WifiOff : CloudOff;

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-100 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <Icon className="mx-auto size-8 text-slate-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">No offline exam available</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          We could not reach the server and there is no saved copy of this paper
          on your device yet. Take the exam once while online to download it for
          offline use.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#4B1D6F] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3d175b]"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
