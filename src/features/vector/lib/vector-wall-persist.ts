import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { mergeWallHistory, type WallHistorySample } from "./vector-wall-history";
import type { VectorDteHorizon } from "./vector-dte-horizon";

const KEY_PREFIX = "vector:wall-history";
/** Keep through the next session for off-hours review + replay groundwork. */
// 72h hot-cache (was 48h): bridges weekends so Monday's first reads of Friday rails stay hot.
// LONG-TERM RETENTION IS POSTGRES, NOT THIS TTL — every sample write-throughs to the durable DB
// mirror (no deletion), and loadSessionWallHistory falls back to it and re-warms Redis, so
// 15-day replay reads work regardless of this TTL. Do not bump this to "fix" retention.
const TTL_SEC = 72 * 60 * 60;

/**
 * Storage identity for a (ticker, horizon) rail. Each DTE horizon records its OWN point-in-time
 * trail so 0DTE/weekly/monthly show frozen clusters after close just like "All" — but rather than
 * migrate the schema, a narrowed horizon is stored under a COMPOSITE ticker (`NVDA::weekly`) in
 * both the Redis key and the Postgres `ticker` column. "all" keeps the bare ticker, so every rail
 * recorded before per-horizon history existed (and every "all" read) is byte-for-byte unchanged —
 * fully backward-compatible, no ALTER TABLE, no data backfill.
 */
export function wallRailStorageId(ticker: string, horizon: VectorDteHorizon = "all"): string {
  return horizon === "all" ? ticker : `${ticker}::${horizon}`;
}

function redisKey(storageTicker: string, sessionYmd: string): string {
  return `${KEY_PREFIX}:${storageTicker}:${sessionYmd}`;
}

/**
 * Load the durable per-bar wall ladder for a session (shared across replicas).
 *
 * Redis-first (hot cache). On a Redis miss — cold replica, eviction, restart — fall back to
 * the durable Postgres mirror and, if it has a rail, WARM Redis with it so the next read is hot
 * again. Both the DB module import and the DB call are wrapped so a failure degrades to the
 * legacy Redis-only behaviour (return []) rather than throwing into the caller.
 */
export async function loadSessionWallHistory(
  sessionYmd: string,
  ticker = "SPX",
  horizon: VectorDteHorizon = "all"
): Promise<WallHistorySample[]> {
  if (!sessionYmd) return [];
  const st = wallRailStorageId(ticker, horizon);
  const hit = await sharedCacheGet<WallHistorySample[]>(redisKey(st, sessionYmd));
  if (hit && hit.length) return hit;

  // Redis empty/absent — try the durable Postgres mirror. Lazy dynamic import keeps the
  // server-only DB module out of any client bundle that transitively reaches this file.
  try {
    const { loadSessionWallHistoryFromDb } = await import("./vector-wall-db");
    const durable = await loadSessionWallHistoryFromDb(sessionYmd, st);
    if (durable.length) {
      // Re-warm the hot cache — by UNION, never by overwrite.
      //
      // This path is reached on ANY empty Redis read, which is NOT only eviction: a transient
      // read failure or timeout returns null here too. The Postgres mirror is deliberately BEHIND
      // Redis (appendSessionWallSample's write-through is a non-blocking `void (async () => …)`),
      // so a blind `sharedCacheSet(durable)` stamps a SHORTER rail over a longer, correct one —
      // and every subsequent read then serves the short rail until the recorder catches up.
      //
      // Live 2026-08-07: META's rail regressed 127 samples → 92 and its leading edge moved BACK
      // from 09:46:05 to 09:40:05 — same session start, fewer samples, internally consistent, i.e.
      // rolled back to an earlier state rather than corrupted. CloudWatch showed **zero
      // ElastiCache evictions** on both nodes across the window (memory 15–20%), which REFUTES the
      // eviction theory and leaves the transient-miss path as the mechanism — it needs no memory
      // pressure at all.
      //
      // Re-reading and unioning makes the re-warm monotonic: if Redis actually still holds a
      // longer rail (the read merely blipped), `mergeWallHistory` keys by bucket time and keeps
      // it; if Redis is genuinely cold, the union degenerates to the durable rail and behaves
      // exactly as before. A rail can therefore never get SHORTER as a result of a read.
      const fresh = await sharedCacheGet<WallHistorySample[]>(redisKey(st, sessionYmd)).catch(() => null);
      const warmed = mergeWallHistory(fresh ?? [], durable);
      await sharedCacheSet(redisKey(st, sessionYmd), warmed, TTL_SEC).catch(() => {});
      return warmed;
    }
  } catch (err) {
    console.warn(`[vector-wall-persist] db fallback failed ${st}:${sessionYmd}:`, err);
  }
  return hit ?? [];
}

/**
 * Append/replace one bar sample into the session ring (best-effort).
 *
 * The write is a read-modify-write with no lock, so with 2+ replicas two
 * writers can interleave — merging by time (union) instead of appending to
 * the tail bounds the damage to "last write for the SAME bucket wins" rather
 * than "whole array from the stale reader wins": a bucket written by replica
 * B can no longer be dropped entirely by replica A writing from a pre-B read,
 * because A's fresh read (immediately before the set) already contains B's
 * bucket and the union preserves it.
 */
// ── Durable write-through queue ───────────────────────────────────────────────────────────────
//
// The DB mirror used to be dispatched per sample: `void (async () => persistWallSampleToDb(...))()`
// — fire-and-forget with NO concurrency bound. The recorder writes ~122 tickers x 4 horizons =
// ~488 samples every 5 seconds against a pool of PG_POOL_MAX=4, so demand (~98 writes/sec) ran
// well past what four connections could drain. The pool's waiter queue grew without limit and
// every caller past the 15s connectionTimeoutMillis threw "timeout exceeded when trying to
// connect", continuously, across dozens of tickers (prod, 2026-08-12).
//
// That was not a slow rail — it was SILENT DATA LOSS. Redis keeps rails 72h; Postgres is the
// 15-day durable mirror. With the mirror rejecting writes, anything past the TTL was gone.
//
// Coalescing into one multi-row INSERT per flush turns ~488 round-trips into a handful. The queue
// is keyed by (ticker, session, bucket) so a re-recorded bucket REPLACES its pending entry rather
// than queueing twice — the same idempotence the ON CONFLICT upsert gives, applied before the
// write instead of after it.
const durableQueue = new Map<string, { sessionYmd: string; ticker: string; sample: WallHistorySample }>();
let durableFlushTimer: ReturnType<typeof setTimeout> | null = null;
let durableFlushInFlight = false;
/** Flush cadence. Below the 5s recorder tick so a sweep's writes leave in one or two batches. */
const DURABLE_FLUSH_MS = 2_000;
/**
 * Hard cap on pending rows. If the DB is down, the queue must not become a memory leak that takes
 * the worker with it — beads are a supplementary visual and Redis still has them. Dropping the
 * OLDEST is deliberate: the newest samples are the ones a member is about to look at.
 */
const DURABLE_QUEUE_MAX = 5_000;

function enqueueDurableWallSample(
  sessionYmd: string,
  storageTicker: string,
  sample: WallHistorySample
): void {
  durableQueue.set(`${storageTicker}:${sessionYmd}:${sample.time}`, {
    sessionYmd,
    ticker: storageTicker,
    sample,
  });
  if (durableQueue.size > DURABLE_QUEUE_MAX) {
    const overflow = durableQueue.size - DURABLE_QUEUE_MAX;
    let dropped = 0;
    for (const k of durableQueue.keys()) {
      durableQueue.delete(k);
      if (++dropped >= overflow) break;
    }
    console.warn(
      `[vector-wall-persist] durable queue over ${DURABLE_QUEUE_MAX} — dropped ${dropped} oldest pending rows (DB likely unavailable)`
    );
  }
  if (durableFlushTimer) return;
  durableFlushTimer = setTimeout(() => {
    durableFlushTimer = null;
    void flushDurableWallSamples();
  }, DURABLE_FLUSH_MS);
  (durableFlushTimer as unknown as { unref?: () => void }).unref?.();
}

async function flushDurableWallSamples(): Promise<void> {
  // ONE flush in flight. Overlapping flushes would re-create the unbounded concurrency this queue
  // exists to remove.
  if (durableFlushInFlight || durableQueue.size === 0) return;
  durableFlushInFlight = true;
  // Take the batch out BEFORE awaiting, so samples recorded during the flush queue for the next
  // one instead of being dropped by the clear.
  const batch = [...durableQueue.values()];
  durableQueue.clear();
  try {
    const { persistWallSamplesToDb } = await import("./vector-wall-db");
    await persistWallSamplesToDb(batch);
  } catch (err) {
    console.warn(`[vector-wall-persist] durable flush failed (${batch.length} rows):`, err);
  } finally {
    durableFlushInFlight = false;
    // Anything that arrived mid-flush gets its own timer rather than waiting for the next append.
    if (durableQueue.size > 0 && !durableFlushTimer) {
      durableFlushTimer = setTimeout(() => {
        durableFlushTimer = null;
        void flushDurableWallSamples();
      }, DURABLE_FLUSH_MS);
      (durableFlushTimer as unknown as { unref?: () => void }).unref?.();
    }
  }
}

/** Test-only: drain synchronously so a suite can assert on what would be written. */
export async function _flushDurableWallSamplesForTest(): Promise<void> {
  await flushDurableWallSamples();
}

/** Test-only: how many rows are pending. */
export function _durableWallQueueSizeForTest(): number {
  return durableQueue.size;
}

/**
 * Last rail THIS process wrote, per (storageId, sessionYmd) — the read-side of the append.
 *
 * WHY: every append used to Redis-GET the ENTIRE session rail, JSON-parse it, merge one sample,
 * and stringify the whole thing back. With ~122 tickers x 4 horizons that is ~488 full-rail
 * read-modify-writes every 5 seconds, against arrays that grow all session (cap 5760 samples,
 * each carrying a full wall ladder). The cost is O(rail length) per bead and therefore grows
 * through the day — which is exactly the observed shape: the sweep ran at 10s near the open on
 * 2026-08-07 and ~30s by midday on 2026-08-12, with one worker pinned at 100% CPU. The JSON work
 * WAS the compute bottleneck.
 *
 * Serving the prior rail from memory removes the GET and the parse (half the JSON cost and ~488
 * Redis round-trips per sweep) while still writing through, so readers on other replicas are
 * unaffected.
 *
 * CORRECTNESS depends on single-writer ownership, which is why this ships WITH sharding: each
 * ticker is swept by exactly one replica, so nothing else is appending to that rail concurrently.
 * Two guards keep it honest even when that assumption is violated (a slot handover mid-session,
 * an orphan adopted by a second replica):
 *   - the merge is by bucket time and monotonic, so a stale memory rail can only ever MISS
 *     someone else's bucket, never delete it — the next resync picks it up;
 *   - the cache is force-refreshed from Redis every RESYNC_MS, bounding any divergence.
 * That is strictly safer than the previous behaviour, which had no lock either and relied on the
 * same union semantics with two replicas racing on every single write.
 */
const railMemo = new Map<string, { rail: WallHistorySample[]; at: number }>();
/** How long a memoized rail may be trusted before we re-read Redis. */
const RAIL_MEMO_RESYNC_MS = 60_000;

/** Test-only reset so a suite cannot leak one test's rail into the next. */
export function _resetWallRailMemoForTest(): void {
  railMemo.clear();
}

export async function appendSessionWallSample(
  sessionYmd: string,
  sample: WallHistorySample,
  ticker = "SPX",
  horizon: VectorDteHorizon = "all"
): Promise<boolean> {
  if (!sessionYmd) return false;
  const st = wallRailStorageId(ticker, horizon);
  try {
    const memoKey = `${st}:${sessionYmd}`;
    const memo = railMemo.get(memoKey);
    const existing =
      memo && Date.now() - memo.at < RAIL_MEMO_RESYNC_MS
        ? memo.rail
        : await loadSessionWallHistory(sessionYmd, ticker, horizon);
    const next = mergeWallHistory(existing, [sample]);
    if (next === existing) return false; // no-op merge — nothing new to write
    await sharedCacheSet(redisKey(st, sessionYmd), next, TTL_SEC);
    // Memoize only AFTER the write lands. Caching an unwritten rail would let a failed Redis SET
    // silently become this process's idea of the truth, and every later append would build on a
    // rail that exists nowhere else — the memo must never be ahead of the store.
    // `at` is only refreshed on a real Redis resync (below), so the resync window is measured from
    // the last authoritative READ, not from the last write. Otherwise a busy rail written every 5s
    // would keep pushing its own deadline out and never resync at all.
    railMemo.set(memoKey, { rail: next, at: memo?.at ?? Date.now() });
    // Durable write-through: fan the SAME bucket out to Postgres so the rail survives Redis
    // restarts. Non-blocking and best-effort — Redis stays authoritative for the boolean
    // return, and a DB failure (or the server-only module failing to load in an unexpected
    // context) must not affect the live recorder. Lazy dynamic import keeps the server-only
    // DB module out of any client bundle that transitively reaches this file.
    enqueueDurableWallSample(sessionYmd, st, sample);
    return true;
  } catch (err) {
    // Persistence is a supplementary visual and must never block the live stream —
    // but swallowing the error SILENTLY hid a session-long recording gap (an empty
    // off-hours rail) behind a green {ok} cron for hours. Log it so the failure is
    // observable in CloudWatch without changing the non-blocking contract, and
    // return false so callers can tally how many samples actually landed.
    console.warn(`[vector-wall-persist] append failed ${st}:${sessionYmd}:`, err);
    return false;
  }
}

/**
 * Load only the newest `limit` samples of a session's rail.
 *
 * FOR CALLERS THAT WANT A SESSION'S LAST READING, NOT ITS SESSION. `daily-regime` keeps one sample
 * per session across ~15 sessions; loading each rail in full to do that measured 30.2s for a 1.3 KB
 * response on SPX (oracle cadence: ~5,760 samples, each a 20-per-side ladder).
 *
 * ORDERING IS DELIBERATELY INVERTED vs `loadSessionWallHistory`, and only for SETTLED sessions.
 * The normal path is Redis-first because Redis is the hot, authoritative-because-freshest copy —
 * the Postgres mirror is written through non-blocking and therefore lags. Redis stores a rail as
 * ONE JSON blob, so "give me the last sample" still costs a full fetch-and-parse there, while
 * Postgres answers it with a single index seek on `(ticker, session_ymd, bucket_time)`.
 *
 * That trade is only safe once a session can no longer change:
 *  - `sessionYmd` in the PAST → the mirror has long since caught up, so DB-tail first, Redis as
 *    fallback when the DB is unconfigured or has no rows for it.
 *  - `sessionYmd` TODAY (or anything not strictly earlier than `todayYmd`) → fall straight through
 *    to the full Redis-first read. Today's rail is still being written, and the mirror's lag would
 *    show up as a stale "last reading" — which is precisely the value this function exists to
 *    return. Correctness first; today is one session out of fifteen.
 *
 * `todayYmd` is passed in rather than computed so this stays pure w.r.t. the clock and testable.
 */
export async function loadSessionWallTail(
  sessionYmd: string,
  ticker = "SPX",
  horizon: VectorDteHorizon = "all",
  limit = 1,
  todayYmd?: string
): Promise<WallHistorySample[]> {
  if (!sessionYmd) return [];
  const st = wallRailStorageId(ticker, horizon);
  const settled = todayYmd != null && sessionYmd < todayYmd;

  if (settled) {
    try {
      const { loadSessionWallTailFromDb } = await import("./vector-wall-db");
      const tail = await loadSessionWallTailFromDb(sessionYmd, st, limit);
      if (tail.length) return tail;
    } catch (err) {
      console.warn(`[vector-wall-persist] tail read failed ${st}:${sessionYmd}:`, err);
    }
  }

  // Not settled, DB unconfigured, or no durable rows: the full read is always correct, just dearer.
  const full = await loadSessionWallHistory(sessionYmd, ticker, horizon);
  return limit >= full.length ? full : full.slice(-limit);
}
