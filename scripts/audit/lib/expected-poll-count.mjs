/**
 * How many times a URL could LEGITIMATELY be fetched during a run of length `elapsedMs`.
 *
 * WHY THIS EXISTS. `meridian-interaction-audit.mjs` flagged any `/api/` URL fetched more than
 * twice as a duplicate-fetch defect. Two of Meridian's panels POLL ON PURPOSE — `MeridianDesk`
 * drives the event detail through SWR with `refreshInterval: detailRefreshMsFor(...)`, which is
 * **10s** for an event minutes from its print and **15s** for one that has already printed
 * (`meridian-viz-core.ts:1066`). A run that keeps the page open for a minute while cycling tabs
 * therefore fetches the detail four to six times, correctly.
 *
 * Measured on prod 2026-08-21: `4× /api/market/meridian/event?id=earnings:BEKE:2026-08-21`,
 * reported as a defect. BEKE printed that morning, so the panel was on the 15s lane and the audit
 * held the page for ~60s. The product was doing exactly what it was designed to do.
 *
 * WHY A FALSE POSITIVE HERE IS EXPENSIVE. It fires on the panels polling FASTEST — which are the
 * ones nearest a live catalyst, the highest-value state in the product. A check that cries wolf
 * on correct behaviour teaches its reader to skim past it, and then the real fetch storm it exists
 * to catch reads as more of the same. Same failure as a verdict without its cohort: confidently
 * shaped, and about nothing.
 *
 * The fix is not to exempt the polling endpoints — that would blind the check to a genuine storm
 * on exactly the routes that matter. It is to compare the count against what the KNOWN cadence
 * could produce in the time the page was actually open.
 */

/**
 * The fastest interval any Meridian surface polls at, in ms.
 *
 * Mirrors the floor of `detailRefreshMsFor` (10_000 for an event ≤1h out). Deliberately the
 * FLOOR rather than the per-event value: the harness does not know which lane a given event
 * landed in, and using the fastest possible cadence makes the allowance permissive — this check
 * should only fire when a count cannot be explained by polling at all.
 */
export const FASTEST_POLL_MS = 10_000;

/** URL substrings for surfaces that poll. Anything else is expected to be fetched once or twice. */
const POLLING_PATHS = ["/api/market/meridian/event", "/api/market/meridian/timeline"];

export function isPollingUrl(url) {
  const u = String(url ?? "");
  return POLLING_PATHS.some((p) => u.includes(p));
}

/**
 * The most fetches a URL could rack up in `elapsedMs` without anything being wrong.
 *
 * Non-polling URLs keep the old allowance of 2 — an initial load plus one revalidation. Polling
 * URLs get one per interval, plus one for the initial fetch, plus one for slack: SWR also
 * revalidates on focus and on reconnect, and the harness clicks through tabs, so an exact
 * `elapsed / interval` would sit right on the boundary and flap.
 */
export function expectedMaxFetches(url, elapsedMs) {
  if (!isPollingUrl(url)) return 2;
  const ms = Number(elapsedMs);
  if (!Number.isFinite(ms) || ms <= 0) return 2;
  return Math.ceil(ms / FASTEST_POLL_MS) + 2;
}

/**
 * Split observed counts into genuine over-fetches and polling that is doing its job.
 *
 * Returns both halves. The caller reports the first and — this is the point — can still SAY how
 * many were explained, so "no duplicate fetches" never silently means "the check was widened
 * until nothing fired".
 */
export function splitOverFetches(counts, elapsedMs) {
  const over = [];
  const explained = [];
  for (const [url, n] of counts) {
    const max = expectedMaxFetches(url, elapsedMs);
    (n > max ? over : explained).push({ url, count: n, max });
  }
  return { over, explained: explained.filter((e) => e.count > 2) };
}
