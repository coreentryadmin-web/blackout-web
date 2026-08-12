/**
 * Keep a browser context's Clerk cookie ALIVE for the length of a run.
 *
 * MEASURED 2026-08-09 (see lib/prod-clerk-session.mjs): the minted `__session` JWT is dead ~72s
 * after issue, and continuous requests do NOT extend it — a fixed lifetime, not an idle timeout.
 * Any harness that mints one cookie and drives a browser for several minutes is therefore
 * unauthenticated for most of its run.
 *
 * That failure is invisible and expensive, because a 401 does not look like a 401 in a UI: panels
 * render their empty state, so the run reports "GEX ladder unavailable", "Universe snapshot
 * unavailable", "No historical data" — a page full of product defects that are really one expired
 * token. The repo has already chased exactly this once (#1961), and the interaction audit
 * reproduced it again on its first live run: a burst of 401s on
 * `/api/market/vector/universe`, `/api/market/spx/pin` and `/api/market/vector/daily-bars`
 * roughly ninety seconds in, on endpoints that had served 200 moments earlier.
 *
 * So: re-mint on a timer and push the new cookie into the context's jar. The refresh re-uses the
 * EXISTING session's cookies rather than performing a fresh ticket exchange, so it is not the
 * "authenticate once per run" path CLAUDE.md warns about — but it still belongs on a timer measured
 * in tens of seconds, not per request.
 */

/** Comfortably inside the measured ~72s lifetime, with room for a slow round-trip. */
const REFRESH_MS = 45_000;

/**
 * Starts a refresh timer against one Playwright context.
 *
 * Returns `stop()`. ALWAYS call it — an un-cleared interval keeps the process alive after the run
 * finishes, which turns a passing audit into a hung one.
 */
export function keepSessionAlive(ctx, session, hostname, onError) {
  if (typeof session?.refresh !== "function") return () => {};
  const timer = setInterval(async () => {
    try {
      const next = await session.refresh();
      if (!next?.jwt) {
        onError?.("session refresh returned no jwt");
        return;
      }
      // Overwrites by (name, domain, path) — Playwright replaces rather than duplicates.
      await ctx.addCookies([
        {
          name: "__session",
          value: next.jwt,
          domain: hostname,
          path: "/",
          // Clerk deliberately leaves __client_uat readable by JS while __session is httpOnly;
          // only __session is re-minted here, so __client_uat stays pinned at its original value
          // (recomputing it per call intermittently 401s every request after the first).
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]);
    } catch (e) {
      onError?.(String(e).slice(0, 120));
    }
  }, REFRESH_MS);
  // Never hold the event loop open on account of the keep-alive itself.
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * A 401 on a first-party API means the token died despite the keep-alive — the run's own
 * credential, not the product. Reporting it as a product failure is how an expired cookie becomes
 * a bug report, so harnesses use this to route it to the right place.
 */
export const isAuthExpiry = (status) => status === 401 || status === 403;
