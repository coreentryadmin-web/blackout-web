import { isWsUpdatedAtFresh } from "@/lib/ws/timestamp-freshness";

/**
 * Shared "how long ago" formatter for the small toolbar age chips (GEX/VEX lens, dark-pool
 * toggle). Extracted from VectorLensToggle.tsx's local `formatLensAge` so a second toggle needing
 * the same "· 5m" chip doesn't duplicate the rule — the rounding/threshold choice (seconds under a
 * minute, whole minutes after) is a decision that should live in exactly one place.
 */
export function formatVectorAge(asOf: number | null | undefined, now: number | null): string | null {
  if (asOf == null || now == null || asOf <= 0) return null;
  const s = Math.max(0, Math.floor((now - asOf) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

/** Past this age the shared universe snapshot (rebuilt by a 5-minute cron) is old enough to call
 *  out — two missed cron cycles — shared by every consumer of `useVectorUniverseSnapshot` so the
 *  staleness threshold can't drift between them (extracted 2026-08-27 when the second consumer,
 *  VectorTickerComparisonStrip, needed the same disclosure VectorScanner already had). */
export const VECTOR_UNIVERSE_STALE_MS = 10 * 60 * 1000;

/** True when the universe snapshot is too old to trust, or its `updatedAt` is clock-skewed future. */
export function isVectorUniverseSnapshotStale(
  updatedAt: number | null | undefined,
  now: number | null,
  staleMs = VECTOR_UNIVERSE_STALE_MS
): boolean {
  if (now == null || updatedAt == null || updatedAt <= 0) return false;
  return !isWsUpdatedAtFresh(updatedAt, staleMs, now);
}

/**
 * The universe snapshot's TRUE freshness signal — the median row `asOf`, not the wrapper's
 * `updatedAt`. `updatedAt` is stamped to `Date.now()` on EVERY write to the snapshot, including
 * `ensureTickerInUniverseSnapshot`'s single-ticker append path (vector-universe.ts), which
 * refreshes exactly ONE row and merges it into an otherwise-untouched roster. Any member opening
 * any single Vector ticker anywhere bumps `updatedAt` for the WHOLE shared snapshot, so the
 * staleness chips built specifically to catch a frozen 5-minute cron (VectorScanner/
 * VectorTickerComparisonStrip's own 2026-08-27 "BUG FIX" comments) read "just updated" almost
 * continuously during market hours regardless of whether the bulk of the roster actually
 * refreshed — confirmed live 2026-09-14: `updatedAt` 2.1min old while the MEDIAN row `asOf` across
 * 57 tickers was 71.4min old (SPX/SPY at ~30min, one freshly-touched ticker at ~2min, everything
 * else ~71-72min — exactly the single-ticker-append skew this function corrects for). Largo's
 * `vector-analytics.ts` screener tool has the same defect one layer further out: its own comment
 * claims "a scanner list is only as current as the sweep behind it" while reporting bare
 * `universe.updatedAt` as that currency, so a member asking Largo "how fresh is this" got the same
 * misleadingly-fresh answer as the UI chip.
 *
 * The MEDIAN (not min/max) is deliberate: a single fresh single-ticker append should not mask a
 * genuinely stale roster (rules out max/latest), and a handful of tickers that never resolve (no
 * chain, always null `asOf`) should not permanently pin the whole snapshot "stale" either (rules
 * out min/oldest) — the median is resistant to either kind of outlier and tracks what the cron's
 * OWN full fan-out actually last touched for most of the roster.
 *
 * Falls back to `updatedAt` only when no row carries a usable `asOf` (an empty or legacy
 * snapshot) — never fabricates a timestamp.
 */
export function effectiveUniverseAsOf(
  snapshot:
    | { updatedAt: number | null | undefined; rows: readonly { asOf: number | null | undefined }[] }
    | null
    | undefined
): number | null {
  if (!snapshot) return null;
  const ages = snapshot.rows
    .map((r) => r.asOf)
    .filter((a): a is number => Number.isFinite(a) && (a as number) > 0)
    .sort((a, b) => a - b);
  if (ages.length === 0) {
    return Number.isFinite(snapshot.updatedAt as number) ? (snapshot.updatedAt as number) : null;
  }
  return ages[Math.floor(ages.length / 2)]!;
}
