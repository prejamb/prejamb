import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import Navbar from "@/components/Navbar";
import OfflineSyncBootstrap from "@/components/OfflineSyncBootstrap";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import SWRegister from "@/components/pwa/SWRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "PreJamb — JAMB UTME Practice & Diagnostics",
  description:
    "Timed JAMB UTME practice with instant scoring, topic-level weakness analysis and step-by-step explanations.",
  applicationName: "PreJamb",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "PreJamb",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png" }],
  },
  other: {
    // Next maps `appleWebApp.capable` to `mobile-web-app-capable` only; iOS
    // still requires the Apple-prefixed tag to launch in standalone mode.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#6f42eb",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <SWRegister />
        <OfflineSyncBootstrap />
        <InstallPrompt />

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
