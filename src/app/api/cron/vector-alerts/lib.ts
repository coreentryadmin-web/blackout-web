/**
 * Pure query-shaping helpers for the Vector alerts cron (`route.ts`). Kept dependency-free so the
 * "which tickers does this tick actually need to fetch context for" logic is unit-tested without a
 * DB/Redis/Polygon — the firing logic itself lives entirely in `vector-alerts.ts`'s `evaluateAlerts`
 * and is NOT re-tested here.
 */

export type UserTickerPair = { user_id: string; ticker: string };

/**
 * Distinct tickers across every (user, ticker) pair with at least one enabled rule. The cron
 * fetches live context (spot/walls/flip) ONCE per ticker per tick and reuses it for every user
 * who has a rule on that ticker, rather than re-fetching per user — this is the de-dup set that
 * drives that single context-fetch pass.
 */
export function distinctTickers(pairs: readonly UserTickerPair[]): string[] {
  return [...new Set(pairs.map((p) => p.ticker))];
}

/** Redis key for a (user, ticker) rule set's persisted AlertState across cron ticks. */
export function alertStateCacheKey(userId: string, ticker: string): string {
  return `vector-alert-state:${userId}:${ticker}`;
}

/** Redis key for a ticker's previous-tick spot — shared across ALL users (same tape), used only
 *  to detect a flip-cross sign change between consecutive cron ticks. */
export function priorSpotCacheKey(ticker: string): string {
  return `vector-alert-priorspot:${ticker}`;
}
