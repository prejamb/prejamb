import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  GraduationCap,
  Timer,
  WifiOff,
} from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: Timer,
    title: "Real CBT conditions",
    body: "Timed UTME papers with a question palette, flagging and instant scoring — exactly like the exam hall.",
  },
  {
    icon: BarChart3,
    title: "Topic-level diagnostics",
    body: "See the exact topics costing you marks, with step-by-step explanations for every question.",
  },
  {
    icon: WifiOff,
    title: "Works offline",
    body: "Install the app to practise and review results with no connection, then sync when you are back online.",
  },
];

export default function Home() {
  return (
    <main className="bg-auth flex-1">
      <section className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-white/80 px-3 py-1 text-xs font-semibold text-primary-700 shadow-sm backdrop-blur">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
            Built for the JAMB UTME
          </span>

          <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Practise smarter.
            <span className="block bg-gradient-to-r from-primary-600 via-primary-500 to-primary-800 bg-clip-text text-transparent">
              Walk into UTME ready.
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Timed CBT practice with instant scoring and a diagnostic report that
            shows precisely which topics to fix — online or offline.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/exam/session"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary-600 to-primary-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-600/30 transition-all hover:from-primary-500 hover:to-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 sm:w-auto"
            >
              Start a free practice
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 sm:w-auto"
            >
              Sign in to save progress
            </Link>
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
            <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden="true" />
            No account needed to start practising
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:mt-16 sm:grid-cols-3 sm:gap-5">
          {features.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-card backdrop-blur-sm transition-shadow hover:shadow-card-lg"
            >
              <div className="grid size-10 place-items-center rounded-xl bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-100">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-sm font-semibold text-slate-900">
                {title}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-600">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 rounded-2xl border border-primary-100 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-700 px-6 py-6 text-white shadow-glow sm:mt-12 sm:flex-row sm:px-8">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <div className="hidden size-11 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-inset ring-white/15 sm:grid">
              <GraduationCap className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                Already practised? Review your diagnostic report.
              </p>
              <p className="mt-0.5 text-xs text-primary-100">
                Track scores and weak topics across every attempt.
              </p>
            </div>
          </div>
          <Link
            href="/exam/results"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-primary-800 shadow-sm transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-800"
          >
            My results
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
