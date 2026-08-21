import { logToken } from "@/lib/log-token";
import { sharedCacheGet, sharedCacheSet, sharedListAppend, sharedListRange } from "@/lib/shared-cache";
import { mergeWallHistory, compactHistoryToCap, type WallHistorySample } from "./vector-wall-history";
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
 * APPEND-ONLY rail key (a Redis list), alongside the legacy whole-value blob.
 *
 * ── WHY A SECOND SHAPE ───────────────────────────────────────────────────────────────
 * The blob form makes ONE append cost a whole-rail rewrite: read (or memo), merge, then
 * `sharedCacheSet` the entire growing session. That cost is what capped the recorder. #2273 put all
 * four rails per ticker on the 5s sweep — ~122 to 488 whole-rail rewrites per tick — the sweep blew
 * its 5s budget, the blended rail everyone depends on regressed to 10-25s, and #2274 reverted it
 * the same day. The lesson drawn then was to write the slow horizons less often; the actual problem
 * was that an append cost O(session) at all.
 *
 * With a list, an append is RPUSH of ONE sample: O(1), and its payload does not grow with the
 * session. That is what makes "every universe ticker, every rail, every 5s" affordable rather than
 * a budget negotiation.
 *
 * The blob is still READ (and still written by anything on an older build) so a rollout cannot lose
 * a rail mid-session — see loadSessionWallHistory, which unions both shapes.
 */
function redisListKey(storageTicker: string, sessionYmd: string): string {
  return `${KEY_PREFIX}:seq:${storageTicker}:${sessionYmd}`;
}

/**
 * Hard bound on list length. Above `MAX_HISTORY` (5760) the blob path compacts rather than
 * truncates; the list is trimmed from the left as a backstop only, so this sits well above the
 * compaction cap and exists to stop an unbounded key, not to shape the rail.
 */
const LIST_MAX_LEN = 20_000;


/**
 * Last-wins collapse by bucket time, preserving append order.
 *
 * The list is an append LOG, so the same bucket can appear more than once — from this replica
 * refreshing it, or from two replicas recording the same tick. The newest entry for a bucket is the
 * one to keep, which is exactly the semantics the blob form had via read-modify-write.
 */
function collapseByTimeLastWins(samples: readonly WallHistorySample[]): WallHistorySample[] {
  const byTime = new Map<number, WallHistorySample>();
  for (const s of samples) {
    if (!s || !Number.isFinite(s.time)) continue;
    byTime.set(s.time, s); // later append overwrites earlier
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
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

  // UNION both shapes, never one-or-the-other.
  //
  // The rail is written as an append-only list now (see redisListKey) but the blob still exists for
  // any session that started on an older build, and any replica still running one keeps writing it.
  // Reading only the list would blank a mid-session rail on deploy; reading only the blob would
  // ignore everything recorded since. Merging is cheap — mergeWallHistory already dedupes by bucket
  // time and sorts — and it is also what makes CROSS-REPLICA duplicate appends harmless, which the
  // list form needs since it no longer has a read-modify-write to serialise them.
  const [seq, blob] = await Promise.all([
    sharedListRange<WallHistorySample>(redisListKey(st, sessionYmd)),
    sharedCacheGet<WallHistorySample[]>(redisKey(st, sessionYmd)),
  ]);
  if (seq.length || (blob && blob.length)) {
    // Collapse repeats WITHIN the list first, last-wins per bucket. The append path deliberately
    // re-appends a bucket when the recorder refreshes it with newer walls (the blob form was
    // last-write-wins), and mergeWallHistory only reconciles ACROSS its two arguments — it keeps
    // duplicates inside one of them. Without this collapse a refreshed bucket would render twice.
    const collapsed = collapseByTimeLastWins(seq);
    const merged = mergeWallHistory(blob ?? [], collapsed);
    if (merged.length) return compactHistoryToCap(merged);
  }

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
    console.warn("[vector-wall-persist] db fallback failed", `${logToken(st)}:${logToken(sessionYmd)}`, err);
  }
  // Nothing in either Redis shape and nothing durable.
  return [];
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

/**
 * Is this memoized rail past its trust window?
 *
 * Pure + exported so the resync CLOCK is testable without Redis, a 60-second wait, or a fake timer.
 * It is worth that much ceremony because the previous inline version was wrong in a way that read
 * as correct (see `nextRailMemoAt`) and cost the memo its entire purpose one minute into a session.
 */
export function railMemoNeedsResync(
  memoAt: number | undefined,
  nowMs: number,
  windowMs: number = RAIL_MEMO_RESYNC_MS
): boolean {
  if (memoAt == null || !Number.isFinite(memoAt)) return true;
  return nowMs - memoAt >= windowMs;
}

/**
 * The `at` to store after an append.
 *
 * Advances ONLY when this append actually re-read Redis, so the window measures "how stale may my
 * copy be" from the last authoritative READ — not from the last write, which on a rail written
 * every 5s would keep pushing its own deadline out and never resync at all.
 *
 * The bug this replaces was `at: memo?.at ?? Date.now()`. Same stated intent, different behaviour:
 * it refreshes only when there is NO memo, i.e. exactly once per rail. Every later resync re-read
 * Redis and then wrote the ORIGINAL timestamp back, so from ~60s onward the memo was permanently
 * expired and every append re-read and re-parsed the whole session rail.
 */
export function nextRailMemoAt(
  prevAt: number | undefined,
  resynced: boolean,
  nowMs: number
): number {
  if (resynced || prevAt == null || !Number.isFinite(prevAt)) return nowMs;
  return prevAt;
}

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
    // O(1) APPEND. The previous implementation memoised the rail in-process, merged the new sample
    // into a copy of the WHOLE session, and wrote all of it back on every 5s tick — so the cost of
    // recording one bead grew with the length of the day. RPUSH costs one sample, always.
    //
    // Dedupe moved to the READ (loadSessionWallHistory unions and merges), which is where it has to
    // live anyway now that two replicas can append to the same rail concurrently. The blob form's
    // `next === existing` no-op check could only ever dedupe within ONE process.
    // NOTE: a repeat of the same bucket time is NOT skipped. The recorder legitimately re-writes a
    // bucket with fresher walls inside the same window, and the blob form was last-write-wins per
    // bucket. Appending both and resolving on read preserves that exactly; skipping here would
    // silently pin the FIRST reading of every bucket, which is a data change disguised as an
    // optimisation. Duplicate entries are bounded by the list trim and collapse on read.
    const len = await sharedListAppend(redisListKey(st, sessionYmd), sample, TTL_SEC, LIST_MAX_LEN);

    // Durable write-through: fan the SAME bucket out to Postgres so the rail survives Redis
    // restarts. Non-blocking and best-effort — Redis stays authoritative for the boolean
    // return, and a DB failure (or the server-only module failing to load in an unexpected
    // context) must not affect the live recorder. Lazy dynamic import keeps the server-only
    // DB module out of any client bundle that transitively reaches this file.
    enqueueDurableWallSample(sessionYmd, st, sample);
    return len > 0;
  } catch (err) {
    // Persistence is a supplementary visual and must never block the live stream —
    // but swallowing the error SILENTLY hid a session-long recording gap (an empty
    // off-hours rail) behind a green {ok} cron for hours. Log it so the failure is
    // observable in CloudWatch without changing the non-blocking contract, and
    // return false so callers can tally how many samples actually landed.
    console.warn("[vector-wall-persist] append failed", `${logToken(st)}:${logToken(sessionYmd)}`, err);
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
      console.warn("[vector-wall-persist] tail read failed", `${logToken(st)}:${logToken(sessionYmd)}`, err);
    }
  }

  // Not settled, DB unconfigured, or no durable rows: the full read is always correct, just dearer.
  const full = await loadSessionWallHistory(sessionYmd, ticker, horizon);
  return limit >= full.length ? full : full.slice(-limit);
}
