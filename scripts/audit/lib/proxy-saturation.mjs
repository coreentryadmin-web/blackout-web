/**
 * Waits that let the audit outlast a SATURATED AGENT PROXY, kept here so they are testable and so
 * the numbers exist in exactly one place.
 *
 * MEASURED ON PROD 2026-08-21. Run alone, the mobile viewport completes: `routed: 226 ok, 0 fail`,
 * 0 HARNESS — and 430px is the width the rail-overlap defects were actually found at. Run THIRD,
 * after desktop (173 requests) and tablet (135), it dies on the first navigation with
 * ERR_CONNECTION_RESET having routed 3, every time.
 *
 * Not the product and not the UA: the same page over the same tunnel with the iPhone UA returns
 * 200 and 58,201 bytes, byte-identical to the desktop UA. `docs/audit/LIVE-UI-CONNECTION.md` names
 * this signature — the proxy refuses new CONNECTs while its own failure list stays EMPTY.
 *
 * So the last viewport in a full run was never audited, and the audit called that HARNESS and moved
 * on. A pass that judges nothing is worse than a pass that takes another minute.
 */

/**
 * Waits BETWEEN navigation attempts, in order. Backoff rather than a longer flat wait: if the proxy
 * is reclaiming tunnels then each attempt is likelier than the last, and a run that recovers on
 * attempt 2 should not pay attempt 3's wait. Length + 1 is the attempt count.
 */
export const NAV_RETRY_WAITS_MS = [8_000, 20_000, 40_000];

/** Total navigation attempts before the audit gives up and records HARNESS. */
export const NAV_ATTEMPTS = NAV_RETRY_WAITS_MS.length + 1;

/**
 * How long to wait before attempt `attempt` (0-based) fails for good.
 * Returns `null` when there is nothing left to try — the caller must report HARNESS, never
 * silently continue as though the page had loaded.
 */
export function navRetryWaitMs(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  return NAV_RETRY_WAITS_MS[attempt] ?? null;
}

/** Total time the harness will spend waiting before declaring navigation dead. */
export function navTotalPatienceMs() {
  return NAV_RETRY_WAITS_MS.reduce((a, b) => a + b, 0);
}

/**
 * Pause before the viewport at `index`. Each pass opens a few hundred CONNECTs and closing the
 * browser does not return them instantly, so the next viewport otherwise starts against a proxy
 * that is already full. The first viewport pays nothing.
 */
export const VIEWPORT_COOLDOWN_MS = 30_000;

export function viewportCooldownMs(index) {
  return Number.isInteger(index) && index > 0 ? VIEWPORT_COOLDOWN_MS : 0;
}
