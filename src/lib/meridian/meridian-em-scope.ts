/**
 * WHICH EXPIRY AN EXPECTED MOVE IS ALLOWED TO COME FROM.
 *
 * MEASURED ON PROD 2026-08-21 at 21:50Z. `/api/market/meridian/event` served, for PDD's print
 * three days out:
 *
 *   expected_move_pct: 0.1        expected_move_source: "chain_iv"
 *
 * The options market said otherwise. From the live PDD chain at the same minute — spot 88.53,
 * 2026-08-28 expiry (the one that covers the print) — the ATM straddle was 3.50 + 3.24 = 6.74,
 * an implied move of **7.6%**, with ATM IV 0.61–0.75. Seven of eight high-impact names sampled
 * read 0.1–0.4%.
 *
 * THE MECHANISM. `buildMeridianEarningsIntel` resolves the headline move as
 *
 *   earningsEm ?? vectorEm.movePct * 100 ?? pack.expected_move_pct
 *
 * The first is earnings-scoped (`deriveExpectedMoveInputsForEarningsDate` — "nearest listed expiry
 * ON OR AFTER the print date"). The second is NOT: `getVectorExpectedMove(sym, "weekly")` quotes
 * the WEEKLY HORIZON'S FRONT EXPIRY, which after 16:00 ET is the series that expired that
 * afternoon. `remainingYearsToExpiry` floors a dead expiry at one minute of life rather than
 * returning null, so instead of no answer it produces a tiny one:
 *
 *   atmIv 0.66, dteDays 0.00069  ->  movePct 0.000910  ->  0.1
 *
 * That reproduces the served value exactly. The same inputs against the covering expiry give
 * **9.1**. The error is ~90x, and it DECAYS THROUGH THE SESSION as the front expiry dies — BEKE
 * read 1.2% at 17:14Z, 0.9% mid-afternoon and 0.3% after the close, all labelled `chain_iv`.
 *
 * WHY THIS IS THE FIX. The fallback was not a degraded version of the same quantity — it was a
 * DIFFERENT QUANTITY published under the same name and the same source label. A weekly cone is a
 * fine number; it is not this name's earnings move unless its expiry actually spans the print.
 * So the rule is about the expiry, not about the source: any quote may stand in, provided it
 * covers the event it claims to describe.
 *
 * Pure and total: no IO, no throw.
 */

/** A YYYY-MM-DD date, or nothing. */
function ymd(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * May a quote taken from `quoteExpiry` be published as the expected move for a print on
 * `earningsDate`?
 *
 * True only when both dates are real and the expiry lands ON OR AFTER the print — the same rule
 * `deriveExpectedMoveInputsForEarningsDate` already applies when it picks an expiry itself.
 *
 * UNKNOWN IS NOT YES. A missing expiry or a missing print date returns false: a quote that cannot
 * say which chain it came from cannot be checked, and the failure mode here is publishing a
 * confident number that is wrong by two orders of magnitude.
 */
export function expiryCoversPrint(
  quoteExpiry: unknown,
  earningsDate: unknown
): boolean {
  const q = ymd(quoteExpiry);
  const e = ymd(earningsDate);
  if (q === null || e === null) return false;
  return q >= e;
}
