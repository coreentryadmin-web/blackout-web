// Offline app-shell fallback served by the service worker when navigation fails.
// No data fetching, no auth — must render fully from cache.
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Signal Lost — BlackOut Trading" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-white">Signal lost</h1>
      <p className="max-w-md text-sky-300">
        The desk needs a live connection for real-time flow and SPX structure. Reconnect
        and the terminal picks up where it left off.
      </p>
      <a
        href="/dashboard"
        className="rounded-md border border-cyan-400/40 px-4 py-2 text-cyan-400 hover:bg-cyan-400/10"
      >
        Reconnect
      </a>
    </main>
  );
}
