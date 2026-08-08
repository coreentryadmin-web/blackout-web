// Offline app-shell fallback served by the service worker when navigation fails.
// No data fetching, no auth — must render fully from cache. Dependency-light on
// purpose (Link only), but on-brand to match the route-state pages (not-found.tsx).
import type { Metadata } from "next";
import Link from "next/link";

// Thin PWA fallback screen with no unique content — never indexable.
export const metadata: Metadata = {
  title: "Offline — BlackOut",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-void px-6 text-center">
      <div className="flex max-w-lg flex-col items-center gap-5">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-mute">
          Offline
        </span>

        <h1 className="font-anton text-4xl leading-[0.95] tracking-tight text-white sm:text-5xl">
          You&apos;re offline.
        </h1>

        <p className="max-w-md text-secondary">
          Live flow and SPX structure need a connection. Reconnect and your session will resume.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/dashboard"
            className="rounded-full px-8 py-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-[#010204] transition hover:brightness-110"
            style={{
              background: "#a3e635",
              boxShadow:
                "0 0 30px rgba(163,230,53,0.35), 0 4px 24px rgba(163,230,53,0.2)",
            }}
          >
            Open desk
          </Link>
          <Link
            href="/"
            className="rounded-full border border-white/15 px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] text-secondary transition hover:border-white/25 hover:text-white"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
