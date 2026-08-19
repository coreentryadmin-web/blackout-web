import { todayEtYmd } from "@/lib/providers/spx-session";
import { refreshSharedUniverseCacheIfStale } from "./vector-shared-universe-cache";
import { listSharedUniverseTickers } from "./vector-dynamic-universe";
import { recordVectorUniverseWallSample } from "./vector-universe";
import {
  activeLaneSelectionLimit,
  mapInPool,
  vectorActiveBeadRecordConcurrency,
  vectorBeadRecordConcurrency,
} from "./vector-bead-recorder-logic";
import { partitionUniverseForReplica } from "./vector-bead-shard";
import { selectTickersToRecord } from "./vector-bead-schedule-core";

/**
 * Tickers with a record still in flight, shared across OVERLAPPING sweeps.
 *
 * Module-level on purpose: once the leader stops dropping ticks two sweeps can be alive at once,
 * and a per-call set would let each start the same ticker and hand each its own concurrency
 * budget — turning a latency fix into a load problem.
 */
const recordInFlightTickers = new Set<string>();

/**
 * Monotonic sweep counter, used only to gate which narrowed horizons write on a given tick.
 * Module-level so it advances across sweeps rather than resetting per call.
 */
let narrowedTickIndex = 0;

/**
 * Round-robin cursor for the shared-universe sweep.
 *
 * Module-level for the same reason `recordInFlightTickers` is: fairness is a property ACROSS ticks,
 * so the position has to outlive a single call. Without it the concurrency ceiling served the first
 * `limit` tickers on every tick and never reached the rest — see selectTickersToRecord's fairness
 * note for the simulation (roster 122 / limit 64 -> the tail recorded 0 samples in a whole session).
 */
let sharedSweepCursor = 0;

export { VECTOR_BEAD_RECORD_TICK_MS } from "./vector-bead-recorder-logic";

export type VectorBeadRecordResult = {
  sessionYmd: string;
  total: number;
  recorded: number;
  failed: number;
  /**
   * WHICH tickers failed this pass — not just how many.
   *
   * A per-ticker failure is invisible in `failed` alone: the leader only warns when
   * `recorded === 0` (a whole-pass failure), so one name going dark while 121 others succeed
   * produced `recorded=121, failed=1` and logged NOTHING. Live 2026-08-07: ASTS lost ~10 minutes
   * of rail across the opening range and CloudWatch carried zero `append failed` /
   * `zero samples recorded` lines for the entire session — the outage left no trace at all.
   * Naming the failures is what makes a single dark ticker detectable.
   */
  failedTickers: string[];
  /** Every ticker this pass tried. Needed to detect RECOVERY: a ticker that was failing and is now
   *  absent from `failedTickers` only counts as recovered if it was actually attempted. */
  attempted: string[];
  /** Skipped because the previous record is still running. Expected self-throttling, not a fault. */
  busy?: string[];
  /** Skipped because the global concurrency ceiling was already full. Worth alarming if sustained. */
  deferred?: string[];
  elapsedMs: number;
};

/**
 * Record one 5s wall-history bucket for every ticker in the shared sticky universe
 * (static allowlist ∪ dynamic ≤100 / 14d). Viewer-independent — the server-side
 * source of Vector bead rails for all ~100 names.
 */
export async function recordSharedUniverseWallSamples(opts?: {
  sessionYmd?: string;
  concurrency?: number;
  /**
   * Shards this replica owns. Omitted (or empty) = record the WHOLE universe, which is the
   * single-leader behaviour every existing caller and test relies on — sharding is opt-in from
   * the leader, so the HTTP backup cron keeps full coverage on its own.
   */
  shards?: readonly number[];
}): Promise<VectorBeadRecordResult> {
  const sessionYmd = opts?.sessionYmd ?? todayEtYmd();
  const started = Date.now();
  if (!sessionYmd) {
    return { sessionYmd: "", total: 0, recorded: 0, failed: 0, failedTickers: [], attempted: [], elapsedMs: 0 };
  }

  await refreshSharedUniverseCacheIfStale(true);
  const all = await listSharedUniverseTickers();
  // Own slice only, when the caller told us which shards are ours. `attempted`/`failedTickers`
  // below are then this replica's slice — which is what the dark-ticker tracker wants: a ticker
  // another replica owns is not "attempted and failed" here, it is simply not ours, and counting
  // it as failed would fire a false DARK alarm on every peer's tickers.
  const tickers =
    opts?.shards && opts.shards.length > 0
      ? partitionUniverseForReplica(all, opts.shards)
      : all;
  const nowSec = Math.floor(Date.now() / 1000);
  const concurrency = opts?.concurrency ?? vectorBeadRecordConcurrency();

  // Rolling pool, not fixed chunks: this sweep has a 5s deadline (the leader drops any tick that
  // overlaps a running sweep), and a per-chunk barrier made the cost the SUM of each chunk's
  // slowest ticker. See mapInPool + vectorBeadRecordConcurrency for the measured 10s-instead-of-5s
  // regression this fixes.
  // Guard the TICKER, not the sweep. The leader used to drop any tick landing while the previous
  // sweep ran, so ONE slow name cost all ~122 tickers their sample — measured live 2026-08-18 as a
  // 60s median gap against a 5s spec. A ticker still recording skips this tick and only this tick.
  const decision = selectTickersToRecord({
    tickers,
    inFlight: recordInFlightTickers,
    limit: concurrency,
    cursor: sharedSweepCursor,
  });
  sharedSweepCursor = decision.nextCursor;
  const startable = decision.start;
  for (const t of startable) recordInFlightTickers.add(t);

  // One index per SWEEP, not per ticker — every ticker in a tick must agree on which horizons
  // are being written, or the slow rails would smear across tickers instead of landing together.
  const tickIndex = narrowedTickIndex;
  narrowedTickIndex = (narrowedTickIndex + 1) % Number.MAX_SAFE_INTEGER;

  const results = await mapInPool(startable, concurrency, (ticker) =>
    recordVectorUniverseWallSample(ticker, {
      sessionYmd,
      nowSec,
      bucketScope: "universe",
      wallWriteSource: "bead-recorder-universe",
      narrowedTickIndex: tickIndex,
    })
  );

  let recorded = 0;
  let failed = 0;
  const failedTickers: string[] = [];
  // mapInPool guarantees results stay INDEX-ALIGNED with `tickers` despite out-of-order
  // completion, which is what makes this attribution correct rather than arbitrary.
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === "fulfilled" && r.value) recorded += 1;
    else {
      failed += 1;
      const t = startable[i];
      if (t) failedTickers.push(t);
    }
  }

  // One immediate retry for cold heatmap blips — live 2026-08-14 AMD/AAPL showed ~30s median
  // gaps with only ~9–17 samples in a 20m window while peers stayed at 5s. A transient Polygon
  // miss returns historyRecorded=false without throwing, which used to leave a name dark until
  // the next successful sweep (and the next tick may land while recordInFlight, skipping again).
  if (failedTickers.length > 0) {
    const retryTargets = [...failedTickers];
    const retryResults = await mapInPool(retryTargets, concurrency, (ticker) =>
      recordVectorUniverseWallSample(ticker, {
        sessionYmd,
        nowSec,
        bucketScope: "universe",
        wallWriteSource: "bead-recorder-universe",
      })
    );
    const recovered: string[] = [];
    for (let i = 0; i < retryResults.length; i++) {
      const r = retryResults[i]!;
      const t = retryTargets[i]!;
      if (r.status === "fulfilled" && r.value) {
        recorded += 1;
        failed -= 1;
        recovered.push(t);
      }
    }
    if (recovered.length) {
      for (const t of recovered) {
        const idx = failedTickers.indexOf(t);
        if (idx >= 0) failedTickers.splice(idx, 1);
      }
    }
  }

  // Release only AFTER the retry, so a ticker mid-retry is still seen as busy by an overlapping
  // tick rather than being started a second time concurrently.
  for (const t of startable) recordInFlightTickers.delete(t);

  return {
    sessionYmd,
    total: tickers.length,
    recorded,
    failed,
    failedTickers,
    // Only what this tick actually STARTED. A busy ticker was not attempted-and-failed, and
    // counting it so would fire a false DARK alarm on a name that is simply mid-record.
    attempted: startable,
    busy: decision.busy,
    deferred: decision.deferred,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Record 15s wall-history buckets for tickers with active Vector SSE viewers that are
 * NOT in the shared universe yet (on-demand symbols — PLTR, ASTS first view, etc.).
 * Replaces the old "only when universe cron hits every 5 min" gap for non-universe names.
 *
 * ── WHY THIS MIRRORS THE UNIVERSE LANE ───────────────────────────────────────────────
 * Everything #2303 fixed on the 5s sweep was true here too and was left untouched:
 *   - the lane was guarded WHOLESALE by `activeRecordInFlight` in the leader, so one slow viewer
 *     ticker cost EVERY other viewer their 15s sample — the same drop-the-tick shape, on a lane
 *     where a dropped tick is 15s of missing beads rather than 5s;
 *   - it fanned out with a bare `Promise.allSettled` over every active viewer, i.e. NO concurrency
 *     ceiling on the one input a member can move at will; and
 *   - it shared no in-flight accounting with the universe sweep, so the same ticker could be
 *     recorded twice concurrently the moment it was promoted into the universe mid-sweep.
 *
 * It now uses the same per-ticker guard, the same shared in-flight set, and the same one-shot
 * retry. The retry matters MORE here: a transient miss costs a viewer 15s of rail, not 5s.
 */
export async function recordActiveNonUniverseWallSamples(opts?: {
  sessionYmd?: string;
  concurrency?: number;
}): Promise<VectorBeadRecordResult> {
  const sessionYmd = opts?.sessionYmd ?? todayEtYmd();
  const started = Date.now();
  if (!sessionYmd) {
    return { sessionYmd: "", total: 0, recorded: 0, failed: 0, failedTickers: [], attempted: [], elapsedMs: 0 };
  }

  const universe = new Set(await listSharedUniverseTickers());
  const { getActiveVectorTickers } = await import("./vector-stream-hub");
  const tickers = getActiveVectorTickers().filter((t) => !universe.has(t));
  if (!tickers.length) {
    return { sessionYmd, total: 0, recorded: 0, failed: 0, failedTickers: [], attempted: [], elapsedMs: Date.now() - started };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const laneCap = opts?.concurrency ?? vectorActiveBeadRecordConcurrency();
  // Both lanes share ONE in-flight set, so the active lane's ceiling has to be expressed through
  // the global one — see activeLaneSelectionLimit for why the arithmetic is what it is.
  const decision = selectTickersToRecord({
    tickers,
    inFlight: recordInFlightTickers,
    limit: activeLaneSelectionLimit(
      laneCap,
      vectorBeadRecordConcurrency(),
      recordInFlightTickers.size
    ),
  });
  const startable = decision.start;
  for (const t of startable) recordInFlightTickers.add(t);

  const results = await mapInPool(startable, laneCap, (ticker) =>
    recordVectorUniverseWallSample(ticker, {
      sessionYmd,
      nowSec,
      bucketScope: "live",
      wallWriteSource: "bead-recorder-active",
    })
  );

  let recorded = 0;
  let failed = 0;
  const failedTickers: string[] = [];
  // mapInPool guarantees results stay INDEX-ALIGNED with `startable` despite out-of-order
  // completion, which is what makes this attribution correct rather than arbitrary.
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === "fulfilled" && r.value) recorded += 1;
    else {
      failed += 1;
      const t = startable[i];
      if (t) failedTickers.push(t);
    }
  }

  // One immediate retry, same as the universe lane. A transient heatmap miss returns
  // historyRecorded=false without throwing; on a 15s lane that leaves the ONE ticker somebody is
  // actually watching dark until the next tick, which may itself skip the name as busy.
  if (failedTickers.length > 0) {
    const retryTargets = [...failedTickers];
    const retryResults = await mapInPool(retryTargets, laneCap, (ticker) =>
      recordVectorUniverseWallSample(ticker, {
        sessionYmd,
        nowSec,
        bucketScope: "live",
        wallWriteSource: "bead-recorder-active",
      })
    );
    for (let i = 0; i < retryResults.length; i++) {
      const r = retryResults[i]!;
      const t = retryTargets[i]!;
      if (r.status === "fulfilled" && r.value) {
        recorded += 1;
        failed -= 1;
        const idx = failedTickers.indexOf(t);
        if (idx >= 0) failedTickers.splice(idx, 1);
      }
    }
  }

  // Release only AFTER the retry, so a ticker mid-retry is still seen as busy by an overlapping
  // tick rather than being started a second time concurrently.
  for (const t of startable) recordInFlightTickers.delete(t);

  return {
    sessionYmd,
    total: tickers.length,
    recorded,
    failed,
    failedTickers,
    // Only what this tick actually STARTED — a busy ticker was not attempted-and-failed, and
    // counting it so would fire a false DARK alarm on a name that is simply mid-record.
    attempted: startable,
    busy: decision.busy,
    deferred: decision.deferred,
    elapsedMs: Date.now() - started,
  };
}
