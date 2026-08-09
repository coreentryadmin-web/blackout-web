/**
 * Pure decisions behind the Vector live-candle REST fallback.
 *
 * Split out for the same reason `vector-dte-walls-core` / `vector-alert-rules-core` are: the parent
 * module reaches Polygon and holds process-level state, so it cannot be exercised from a bare
 * `tsx --test` run. The rules about WHEN to re-fetch, WHEN a cached candle is still usable, and
 * WHICH entry to evict are ordinary logic and belong somewhere they can be pinned.
 */

/** Entry shape the fallback cache stores per ticker. `candle` is deliberately opaque here. */
export type RestFallbackTiming = {
  /** When the cached candle's PRICE was last known good. */
  updatedAt: number;
  /** When the last fetch ATTEMPT completed — success or not. */
  fetchedAt: number;
};

/**
 * Minimum gap between REST snapshot attempts for one ticker.
 *
 * WAS DOCUMENTED AS ~5s AND IMPLEMENTED AS 1s. The parent module's header said "throttled REST
 * snapshot (~5s refresh)" and its call site said "keeps the spot alive at ~5s cadence", while the
 * constant was 1_000. That gap matters because the fallback runs precisely when the WS store is
 * empty — which off-hours is ALWAYS — and the SSE path asks once a second, so the throttle is the
 * only thing bounding provider load. At 1s that is one Polygon snapshot per second per viewed
 * ticker, five times what the code claimed.
 *
 * Kept at 1s rather than silently slowed to the documented 5s: the fallback exists for the case
 * where the WS feed is DOWN during a live session, and quietly making the recovery path 5x staler
 * is a trading-desk behaviour change that should be a deliberate decision, not a docs cleanup. The
 * discrepancy is resolved by fixing the comments to match the code and surfacing the load question
 * here.
 */
export const REST_REFRESH_MS = 1_000;

/** How stale a cached candle may be before it is treated as no price at all. */
export const REST_MAX_AGE_MS = 120_000;

/** Cap on distinct tickers held in the fallback cache. */
export const REST_CACHE_MAX_ENTRIES = 200;

/** True when this ticker is due another REST attempt. A missing entry is always due. */
export function shouldRefreshRest(entry: RestFallbackTiming | undefined, now: number, refreshMs = REST_REFRESH_MS): boolean {
  if (!entry) return true;
  // Guard a clock that went backwards (or a future-stamped entry): treat it as due rather than
  // locking the ticker out of refreshes until real time catches up.
  const age = now - entry.fetchedAt;
  return !(age >= 0) || age >= refreshMs;
}

/** True when a cached candle is fresh enough to serve as the live price. */
export function isRestEntryUsable(
  entry: (RestFallbackTiming & { candle: unknown }) | undefined,
  now: number,
  maxAgeMs = REST_MAX_AGE_MS
): boolean {
  if (!entry?.candle) return false;
  const age = now - entry.updatedAt;
  return age >= 0 && age <= maxAgeMs;
}

/**
 * Which tickers to drop once the cache is over its cap.
 *
 * The previous behaviour was `restFallback.clear()` — wipe EVERY ticker the moment the map passed
 * 200. That evicts by nothing at all: a member sitting on SPY loses their fallback because two
 * hundred unrelated tickers were viewed elsewhere in the process, and the next read has no price
 * until a fresh round trip completes. Dropping the least-recently-fetched entries down to the cap
 * keeps whatever is actually being watched.
 *
 * Returns the keys to delete, oldest first, so the caller stays a plain loop.
 */
export function restCacheEvictions(
  entries: ReadonlyMap<string, RestFallbackTiming>,
  max = REST_CACHE_MAX_ENTRIES
): string[] {
  if (entries.size <= max) return [];
  return [...entries.entries()]
    .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
    .slice(0, entries.size - max)
    .map(([k]) => k);
}
