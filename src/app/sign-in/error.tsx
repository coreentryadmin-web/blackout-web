"use client";

import Link from "next/link";
import RouteErrorBoundary from "@/components/route-error-boundary";

/** Sign-in segment errors — usually stale cached JS after deploy; surface cache hint. */
export default function SignInError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkLoad =
    /loading chunk|chunkloaderror|failed to fetch dynamically imported module|importing a module script failed/i.test(
      props.error?.message ?? ""
    );

  if (!chunkLoad) {
    return <RouteErrorBoundary {...props} />;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-void px-6 text-center">
      <div className="flex max-w-lg flex-col items-center gap-5">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-mute">
          Update required
        </span>
        <h1 className="font-anton text-4xl leading-[0.95] tracking-tight text-white sm:text-5xl">
          Your browser has a stale cache.
        </h1>
        <p className="max-w-md text-secondary">
          A recent deploy left old scripts cached locally. Hard-refresh this page (Cmd+Shift+R on
          Mac, Ctrl+Shift+R on Windows) or clear site data for blackouttrades.com, then try again.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-bull px-6 py-2.5 font-mono text-xs font-medium uppercase tracking-[0.2em] text-[#021c14] shadow-glow-green transition hover:brightness-110"
          >
            Reload page
          </button>
          <Link
            href="/"
            className="rounded-full border border-white/15 px-6 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-secondary transition hover:border-white/25 hover:text-white"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
