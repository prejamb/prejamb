import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import Navbar from "@/components/Navbar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PreJamb — JAMB UTME Practice & Diagnostics",
  description:
    "Timed JAMB UTME practice with instant scoring, topic-level weakness analysis and step-by-step explanations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* `cookies()` inside Navbar is dynamic; Cache Components requires it
            to stream so pages can still prerender their static shell. */}
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              className="h-16 border-b border-slate-200 bg-white"
            />
          }
        >
          <Navbar />
        </Suspense>

        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
