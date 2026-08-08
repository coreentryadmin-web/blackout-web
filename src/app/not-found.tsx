// Branded 404 for the App Router. Server component, dependency-light — does not
// import Nav or heavy components so it renders cleanly off the grid.
import type { Metadata } from "next";
import Link from "next/link";

// Explicit noindex as defense-in-depth alongside the automatic HTTP 404 status —
// see next.config.mjs for the documented Cloudflare edge-cache incident where a
// cached response served the wrong state to the wrong users. Don't rely on status
// code alone for a page a misconfigured cache rule could serve out of context.
export const metadata: Metadata = {
  title: "Page not found — BlackOut",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-void px-6 text-center">
      <div className="flex max-w-lg flex-col items-center gap-5">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-mute">
          404 · Page not found
        </span>

        <h1 className="font-anton text-4xl leading-[0.95] tracking-tight text-white sm:text-5xl">
          This page doesn&apos;t exist.
        </h1>

        <p className="max-w-md text-secondary">
          The link may be outdated or mistyped. Return home or open the desk to continue.
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
