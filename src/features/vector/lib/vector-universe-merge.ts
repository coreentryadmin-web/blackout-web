/**
 * Universe-snapshot MERGE — how a freshly built roster is combined with the one already stored.
 *
 * ── THE DEFECT THIS EXISTS TO FIX ────────────────────────────────────────────────────
 * `buildVectorUniverseSnapshot` fans out over the whole universe with `Promise.allSettled`, keeps
 * the rows that resolved, and persisted that set UNCONDITIONALLY. Nothing ever asked whether the
 * result was worse than what it was replacing. So one bad fan-out — an upstream blip, a rate
 * limit, a cold cache after a deploy — overwrote a healthy roster with whatever few tickers
 * happened to survive, and every consumer read that as the truth until the next rebuild.
 *
 * Measured live on production 2026-08-18, polling the same endpoint every 5s for 74s:
 *
 *     rows  updatedAt   median row age
 *        4  15:43:55    258s -> 311s      (10 of 12 samples: AMZN, FN, QQQ, SOXL)
 *        3  15:41:39    318s
 *       62  15:21:58    1488s
 *       64  15:45:18    46s
 *
 * Four different snapshots alive at once, and the one being served most often held FOUR tickers
 * and was ageing. The bead rails show the consequence: the sweep works from this roster, so
 * tickers outside it fall to the slow on-demand path — blended-rail median gaps of 60s on
 * TSLA/META/AAPL/AMD against a 5s spec, and 300s on the narrowed rails.
 *
 * A second path had the same shape: `ensureTickerInUniverseSnapshot` does load -> append -> store
 * with only IN-PROCESS dedup, so two ECS tasks appending different tickers each persist their own
 * merge and the loser's rows disappear. That is a lost update, and no amount of in-process
 * bookkeeping fixes it across tasks.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────
 * A rebuild is a set of OBSERVATIONS, not a replacement roster. Merge it over what is stored:
 * a ticker that resolved this round gets its fresh row, a ticker that failed keeps its previous
 * row until it goes stale, and a row nothing has refreshed for `maxAgeMs` falls out on its own.
 * That makes a partial build cost nothing — it simply refreshes fewer rows — while a genuinely
 * shrinking universe still converges, just over minutes instead of instantly.
 *
 * Deliberately NOT a "keep the biggest roster" rule: that would pin dead tickers forever and can
 * never shrink. Age is the honest arbiter, because it is the thing that actually says whether a
 * row still describes the market.
 */

export type UniverseRowLike = {
  ticker: string;
  /** Upstream observation time in epoch ms. Null when the builder could not date the row. */
  asOf?: number | null;
};

export type UniverseSnapshotLike<TRow extends UniverseRowLike = UniverseRowLike> = {
  updatedAt: number;
  rows: TRow[];
};

/**
 * How long a row survives without being refreshed.
 *
 * 15 minutes: long enough to ride out a multi-minute upstream outage (the failure this exists
 * for), short enough that a ticker genuinely dropped from the universe disappears within a few
 * rebuild cycles rather than lingering all session.
 */
export const UNIVERSE_ROW_MAX_AGE_MS = 15 * 60 * 1000;

export type MergeResult<TRow extends UniverseRowLike> = {
  rows: TRow[];
  /** Rows taken from the fresh build. */
  refreshed: number;
  /** Rows carried over because this build did not produce them. */
  carried: number;
  /** Rows dropped because nothing refreshed them inside `maxAgeMs`. */
  expired: number;
};

/**
 * Merge a freshly built roster over the stored one.
 *
 * `nowMs` is injected rather than read from the clock so this is deterministic under test — the
 * expiry rule is the whole point of the function and it must be pinned, not sampled.
 */
export function mergeUniverseSnapshot<TRow extends UniverseRowLike>(
  previous: UniverseSnapshotLike<TRow> | null | undefined,
  fresh: readonly TRow[] | null | undefined,
  nowMs: number,
  maxAgeMs: number = UNIVERSE_ROW_MAX_AGE_MS
): MergeResult<TRow> {
  const byTicker = new Map<string, TRow>();
  let carried = 0;
  let expired = 0;

  // Previous rows first, so a fresh row of the same ticker overwrites it below.
  for (const row of previous?.rows ?? []) {
    const ticker = String(row?.ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    // A row with no usable `asOf` cannot be aged out on evidence. Treat it as expirable against
    // the snapshot's own timestamp rather than keeping it forever — an undated row that nothing
    // has refreshed in 15 minutes is exactly as stale as a dated one.
    const stamp = Number.isFinite(row?.asOf as number) ? (row.asOf as number) : previous?.updatedAt;
    if (!Number.isFinite(stamp as number) || nowMs - (stamp as number) > maxAgeMs) {
      expired += 1;
      continue;
    }
    byTicker.set(ticker, row);
    carried += 1;
  }

  let refreshed = 0;
  for (const row of fresh ?? []) {
    const ticker = String(row?.ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    if (byTicker.has(ticker)) carried -= 1; // it is being refreshed, not carried
    byTicker.set(ticker, row);
    refreshed += 1;
  }

  const rows = [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { rows, refreshed, carried, expired };
}

/**
 * Should this build be allowed to REPLACE the stored snapshot outright?
 *
 * Only when it is complete. A build that lost rows to failures is an incomplete observation and
 * must go through the merge instead — that is the whole distinction the old code collapsed by
 * persisting `allSettled`'s survivors as if they were the roster.
 */
export function isCompleteBuild(attempted: number, produced: number): boolean {
  return attempted > 0 && produced >= attempted;
}
