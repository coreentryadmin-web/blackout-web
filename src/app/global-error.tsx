"use client";

// Global error boundary — catches faults in the root layout itself, so it must
// render its OWN <html>/<body> (it replaces the root layout). Kept ultra-robust:
// no imports beyond react, inline styles only since globals may not have loaded.
import { useEffect } from "react";

// Inlined rather than imported from src/lib/chunk-load-error.ts (which route-error-boundary.tsx
// uses) specifically to honor the "no imports beyond react" rule above — this boundary must stay
// loadable even if a sibling chunk (like a shared lib file) is itself the thing that failed to
// load. See that file for the full rationale: a client holding HTML from one deploy can hit a JS
// chunk whose hash rotated on a later deploy mid-rollout; a hard reload re-fetches the current
// manifest and clears it. Reproduced live 2026-08-24: this exact screen crashed a real page load
// during an in-progress production deploy (`ChunkLoadError: Loading chunk 6750 failed.`); a retry
// with no deploy in flight loaded cleanly.
function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && (error.name === "ChunkLoadError" || /Loading chunk [\w-]+ failed/i.test(error.message));
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    if (isChunkLoadError(error)) {
      try {
        const key = "bo-chunk-error-reload-attempted";
        if (!window.sessionStorage.getItem(key)) {
          window.sessionStorage.setItem(key, "1");
          window.location.reload();
        }
      } catch {
        // private mode / storage disabled — skip the auto-reload, the manual button still works
      }
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          textAlign: "center",
          backgroundColor: "#040407",
          color: "#ffffff",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.25rem",
            maxWidth: "32rem",
          }}
        >
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#7dd3fc",
            }}
          >
            Something went wrong
          </span>

          <h1
            style={{
              margin: 0,
              fontSize: "2.25rem",
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              lineHeight: 1,
              color: "#ffffff",
            }}
          >
            BlackOut — critical error
          </h1>

          <p style={{ margin: 0, maxWidth: "26rem", color: "#7dd3fc" }}>
            The app failed to load. Reset to try again.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              borderRadius: "9999px",
              border: "none",
              padding: "0.625rem 1.5rem",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              fontWeight: 500,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#000000",
              backgroundColor: "#a3e635",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
