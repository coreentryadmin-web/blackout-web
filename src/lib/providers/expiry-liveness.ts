/**
 * EXPIRY LIVENESS — has this expiry already settled?
 *
 * THE BUG THIS EXISTS TO FIX. The GEX heatmap's expiry axis was `Array.from(expirySet).sort()`,
 * and max pain was scoped to `sortedAll[0]` — the nearest expiry, with no check that it is still
 * alive. Measured on prod 2026-08-12 (23:46 ET on the 11th, i.e. after that day's close):
 *
 *   - `2026-08-11` was still the first entry in `expiries` AND in `near_term_expiries`
 *   - it contributed ZERO gamma values (every other expiry had 27-230), so the matrix drew a
 *     full leftmost column of "$0.0K" in the most prominent position
 *   - but its OPEN INTEREST still returns from the provider, so `computeMaxPainFromChain` happily
 *     produced a headline "MAX PAIN 771" from contracts that no longer exist
 *
 * Gamma collapses at settlement; open interest does not vanish until the provider drops the
 * contracts. That asymmetry is exactly why the dead column looked harmless while the number
 * derived from it did not.
 *
 * On SPY/SPX — daily expiries — this fires EVERY trading evening, which is precisely when an
 * overnight-positioning desk gets read.
 *
 * WHY 16:00 ET. US equity options settle at the 4pm ET close. Before that, today's expiry is the
 * 0DTE contract and is the single most actionable column on the board — dropping it during RTH
 * would be a far worse bug than the one being fixed. So an expiry dated TODAY is live until the
 * close and dead after it; an expiry dated in the past is always dead.
 *
 * Pure and injectable-clock so the boundary itself is testable.
 */

const ET_TIME_ZONE = "America/New_York";

/** US equity options settle at the 4pm ET close. */
const SETTLEMENT_HOUR_ET = 16;

/** The ET wall-clock hour (0-23) for an instant. */
function etHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    hour: "numeric",
    hour12: false,
  }).format(now);
  const n = Number(h);
  // `hour12:false` can render midnight as "24" in some ICU versions — normalise so a post-midnight
  // instant is never mistaken for late afternoon.
  return Number.isFinite(n) ? n % 24 : 0;
}

/** The ET calendar date (YYYY-MM-DD) for an instant. Mirrors `todayEt` in lib/et-date. */
function etDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET_TIME_ZONE }).format(now);
}

/**
 * True when `expiryYmd` has already settled and must not be shown or measured.
 *
 * Fail-OPEN on a malformed date: an unparseable expiry is treated as LIVE rather than silently
 * dropped, because losing a real column is worse than keeping a suspect one, and the caller has a
 * guard for the all-dead case anyway.
 */
export function isExpirySettled(expiryYmd: string, now: Date = new Date()): boolean {
  const ymd = String(expiryYmd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const today = etDate(now);
  if (ymd < today) return true;
  if (ymd > today) return false;
  return etHour(now) >= SETTLEMENT_HOUR_ET;
}

/**
 * Drop settled expiries, preserving order.
 *
 * FAIL-SAFE: if EVERY expiry is settled the input is returned unchanged. A stale board is bad; a
 * board with no columns at all is worse, and it would also mean the provider is serving nothing
 * current — a condition the caller should surface, not one this helper should paper over by
 * returning empty.
 */
export function liveExpiries(expiries: readonly string[], now: Date = new Date()): string[] {
  const live = expiries.filter((e) => !isExpirySettled(e, now));
  return live.length > 0 ? live : [...expiries];
}
