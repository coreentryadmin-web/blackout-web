/**
 * Pure batch-rotation helper for vector-dark-pool-warm.
 *
 * WHY THIS EXISTS (2026-10-07, live production re-measurement). Two prior fixes already bound
 * this cron's OWN fan-out: PR #3345 (runUwPool, concurrency=3) and PR #3479/#4673
 * (runWithBackgroundUwSweep, reserves one UW concurrency slot for live traffic). PR #5579
 * (2026-10-01) additionally doubled the shared cluster-wide ceiling (UW_GLOBAL_MAX_RPS 2->4).
 * None of these closed the gap: a fresh CloudWatch pull today (2026-10-07, ~13:36/13:56 UTC,
 * post-#5579 deploy, confirmed live via the running ECS task's image tag) still shows
 * warmed=4 failed=51 and warmed=2 failed=53 — the SAME 90%+ per-run failure rate measured
 * back on 2026-09-15, before the RPS ceiling was raised. Root cause, confirmed via live
 * [api-queue-timing] logs in the same window: per-request UW admission-QUEUE WAIT (not HTTP
 * call duration — every observed HTTP call itself completed in well under a second) climbed
 * from ~1.9s to ~18.7s across the run, i.e. near DEFAULT_QUEUE_MAX_WAIT_MS's 20s ceiling
 * (queue-budget.ts). That congestion comes from the AGGREGATE of every concurrent UW caller on
 * the cluster (live member traffic + bie-full-state-snapshot + zerodte-warm, all confirmed
 * running in the same window via `[cron/*] background done` logs) — raising the GLOBAL ceiling
 * helps every caller equally and evidently was not enough; this cron's own `runUwPool` bound
 * already caps ITS contribution to 3 concurrent admission-queue entrants, so there is no further
 * concurrency knob to tighten on this side without changing the shared limiter (out of scope —
 * a cluster-wide capacity change affecting every UW consumer is the owning Vector lane's capacity
 * decision, not a single cron's fix; see docs/audit/FINDINGS.md 2026-09-15 entry).
 *
 * What IS in this cron's own control: how much TOTAL work it asks the shared queue to admit per
 * run. Cutting the per-run ticker count in half (a 2-way rotation, full universe covered every 2
 * runs) halves this cron's own total admission-queue commitment per invocation, which — holding
 * aggregate cluster congestion constant — proportionally reduces how many of ITS OWN tail
 * entrants can cross the 20s queue-wait budget before being dropped. Two-way (not three+) rotation
 * is deliberate: warmVectorDarkPool's cache entries carry a 25-minute TTL
 * (vector-dark-pool-cache.ts), and the cron's own schedule fires every ~10 minutes — a 2-way
 * rotation completes full coverage in ~20 minutes (comfortably under the 25-minute TTL, with
 * margin for schedule jitter); a 3-way rotation would complete in ~30 minutes, already past the
 * TTL, and would trade one failure mode (queue-timeout drops) for another (cache entries expiring
 * empty between warms — exactly the class of regression the cache's own 25-minute TTL, raised
 * from a prior shorter value per its own in-file comment, was written to prevent).
 */

/**
 * Selects the ticker batch to warm THIS run and the cursor to persist for the next one.
 *
 * `cursor` is the index (in `tickers`, mod length) the previous run left off at; 0 on first-ever
 * run or whenever no cursor is in storage yet. Wraps around the end of the list so coverage is
 * contiguous across runs regardless of where the universe list itself changes length between
 * deploys (a shrunk/grown universe just reflows the batch boundaries, never throws).
 *
 * When `batchSize >= tickers.length` the whole universe already fits in one run — returns it
 * unrotated (identical to pre-rotation behavior) and resets the cursor to 0, so a config change
 * back to "no rotation needed" self-heals without carrying a stale mid-list cursor forward.
 */
export function selectDarkPoolWarmBatch(
  tickers: readonly string[],
  cursor: number,
  batchSize: number
): { batch: string[]; nextCursor: number } {
  const total = tickers.length;
  if (total === 0) return { batch: [], nextCursor: 0 };
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    return { batch: tickers.slice(), nextCursor: 0 };
  }
  if (batchSize >= total) {
    return { batch: tickers.slice(), nextCursor: 0 };
  }

  const safeCursor = Number.isFinite(cursor) ? Math.trunc(cursor) : 0;
  const start = ((safeCursor % total) + total) % total;

  const batch: string[] = [];
  for (let i = 0; i < batchSize; i++) {
    batch.push(tickers[(start + i) % total]);
  }
  const nextCursor = (start + batchSize) % total;
  return { batch, nextCursor };
}

/** Half the universe per run (rounded up so an odd-length universe's extra ticker isn't dropped
 *  — it just makes one of the two batches one ticker larger, still full coverage every 2 runs). */
export function halfBatchSize(totalTickers: number): number {
  return Math.ceil(Math.max(0, totalTickers) / 2);
}
