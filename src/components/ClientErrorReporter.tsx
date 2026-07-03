"use client";

import { useEffect } from "react";

// Global, mount-once browser error reporter -> POST /api/telemetry/client-error
// -> error_events (source: "frontend") -> BIE's discovery report. Closes the
// "frontend errors" gap in docs/bie/FULL-SYSTEM-AWARENESS.md.
//
// Deliberately conservative: capped total reports per page load (a component
// stuck re-throwing in a render loop must never flood the endpoint or spam
// the server-side rate limiter into 429s for other tabs on the same IP), and
// de-duped by message+source so the same recurring error only reports once
// per load instead of once per occurrence.

const MAX_REPORTS_PER_LOAD = 8;

function pagePath(): string {
  try {
    return window.location.pathname.slice(0, 300);
  } catch {
    return "";
  }
}

function send(message: string, stack: string | undefined, name: string): void {
  const body = JSON.stringify({ message: message.slice(0, 4000), stack: stack?.slice(0, 4000), name, url: pagePath() });
  try {
    // sendBeacon survives page unload (the exact moment a crash-causing error
    // is most likely to fire) and never blocks the main thread; fetch with
    // keepalive is the fallback for browsers/contexts without it.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(
        "/api/telemetry/client-error",
        new Blob([body], { type: "application/json" })
      );
      if (ok) return;
    }
    void fetch("/api/telemetry/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Never let the reporter itself throw — that would recurse into onerror.
  }
}

export function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();

    const report = (message: string, stack: string | undefined, name: string) => {
      if (sent >= MAX_REPORTS_PER_LOAD) return;
      const key = `${name}:${message}`.slice(0, 500);
      if (seen.has(key)) return;
      seen.add(key);
      sent++;
      send(message, stack, name);
    };

    const onError = (event: ErrorEvent) => {
      report(event.message || "window.onerror", event.error?.stack, event.error?.name || "Error");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason instanceof Error) {
        report(reason.message, reason.stack, reason.name);
      } else {
        report(typeof reason === "string" ? reason : "unhandled rejection", undefined, "UnhandledRejection");
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
