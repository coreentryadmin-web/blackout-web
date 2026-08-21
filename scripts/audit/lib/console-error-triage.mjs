/**
 * Which console errors are the browser ECHOING BACK a failure this harness already caused?
 *
 * `meridian-interaction-audit.mjs` classifies every 401/403 response as HARNESS, with the reason
 * recorded in CLAUDE.md: a run can outlive its ~72s Clerk JWT, and exactly that was mis-read as a
 * product fault three times. But Chromium ALSO logs each of those responses to the console, and
 * the console branch counted them as a product P2 — so the same lost session was reported twice,
 * once correctly as "not a product verdict" and once as a defect. Measured on the tablet pass of
 * the 2026-08-21 RTH run:
 *
 *   [HARNESS] tablet/auth    — 3 auth failures (401/403) — session lost mid-run, NOT a product verdict
 *   [P2]      tablet/console — 3 console errors
 *       "Failed to load resource: the server responded with a status of 401 (Unauthorized)"  x3
 *
 * Three, and three, and the same three. The P2 is manufactured entirely by the harness's own
 * expiry. That is the defect #2552 fixed in a different branch of this same audit — correct
 * behaviour reported as a fault — and it costs the same thing: a standing false positive teaches
 * its reader to skim the console line, which is where a real error would appear.
 *
 * THE RULE IS DELIBERATELY NARROW. Reclassification requires BOTH that the message is a
 * resource-load failure naming a 401/403 AND that the run actually observed auth failures to
 * explain it. A 401 in the console with no corresponding bad response is unexplained, and
 * unexplained stays P2 — "I have a theory about this error" is not the same as "this error is
 * accounted for". Everything else is untouched: a 500, a CORS error, a thrown exception, a React
 * warning all still count.
 *
 * KNOWN AND ACCEPTED: a genuine product 401 — a real entitlement defect — is invisible to this
 * audit, because `splitAuthFailures` already calls every 401/403 harness-attributable. This module
 * does not widen that blind spot, it makes the console branch agree with the branch that already
 * had it. Catching a real 401 needs a session whose expiry is ruled out independently, which is a
 * different check than this one.
 */

/** A console line that is Chromium reporting an HTTP 401/403 it just received. */
export function isAuthEchoConsoleError(text) {
  const t = String(text ?? "");
  if (!/failed to load resource/i.test(t)) return false;
  return /\b(401|403)\b/.test(t);
}

/**
 * Split console errors into the ones the harness's own lost session explains and the rest.
 *
 * @param {readonly string[]} consoleErrors every console error captured during the pass
 * @param {number} authFailureCount how many 401/403 RESPONSES the same pass recorded
 * @returns {{ product: string[], authEcho: string[] }} `product` is what deserves a P2
 */
export function splitConsoleErrors(consoleErrors, authFailureCount) {
  const all = Array.isArray(consoleErrors) ? consoleErrors.map(String) : [];
  // A bad or absent count must make this STRICTER, never looser — the same direction
  // `expectedMaxFetches` chose for a bad elapsed time. Unknown evidence is not evidence.
  //
  // A real number is REQUIRED, not merely something Number() can digest. The one caller passes
  // `auth.length`; a string arriving here means the shape upstream changed, and coercing it is
  // how that goes unnoticed. The repo's recurring defect is the coercion that turns an unknown
  // into a confident value, so this refuses rather than guesses.
  const n = typeof authFailureCount === "number" ? authFailureCount : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return { product: all, authEcho: [] };

  const product = [];
  const authEcho = [];
  for (const line of all) {
    // Never absorb more echoes than there were auth responses to echo. Beyond that count the
    // errors are no longer accounted for by the expiry, so they go back to being product errors.
    if (isAuthEchoConsoleError(line) && authEcho.length < n) authEcho.push(line);
    else product.push(line);
  }
  return { product, authEcho };
}
