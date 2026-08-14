import { todayEtYmd } from "@/lib/providers/spx-session";
import { refreshSharedUniverseCacheIfStale } from "./vector-shared-universe-cache";
import { listSharedUniverseTickers } from "./vector-dynamic-universe";
import { recordVectorUniverseWallSample } from "./vector-universe";
import {
  mapInPool,
  vectorBeadRecordConcurrency,
} from "./vector-bead-recorder-logic";
import { partitionUniverseForReplica } from "./vector-bead-shard";

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
  const results = await mapInPool(tickers, concurrency, (ticker) =>
    recordVectorUniverseWallSample(ticker, { sessionYmd, nowSec, bucketScope: "universe" })
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
      const t = tickers[i];
      if (t) failedTickers.push(t);
    }
  }

  return {
    sessionYmd,
    total: tickers.length,
    recorded,
    failed,
    failedTickers,
    attempted: tickers,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Record 15s wall-history buckets for tickers with active Vector SSE viewers that are
 * NOT in the shared universe yet (on-demand symbols — PLTR, ASTS first view, etc.).
 * Replaces the old "only when universe cron hits every 5 min" gap for non-universe names.
 */
export async function recordActiveNonUniverseWallSamples(opts?: {
  sessionYmd?: string;
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
  const results = await Promise.allSettled(
    tickers.map((ticker) =>
      recordVectorUniverseWallSample(ticker, { sessionYmd, nowSec, bucketScope: "live" })
    )
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
      const t = tickers[i];
      if (t) failedTickers.push(t);
    }
  }

  return {
    sessionYmd,
    total: tickers.length,
    recorded,
    failed,
    failedTickers,
    attempted: tickers,
    elapsedMs: Date.now() - started,
  };
}
