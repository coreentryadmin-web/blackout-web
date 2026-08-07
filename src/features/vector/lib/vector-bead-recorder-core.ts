import { todayEtYmd } from "@/lib/providers/spx-session";
import { listSharedUniverseTickers } from "./vector-dynamic-universe";
import { recordVectorUniverseWallSample } from "./vector-universe";
import {
  mapInPool,
  vectorBeadRecordConcurrency,
} from "./vector-bead-recorder-logic";

export { VECTOR_BEAD_RECORD_TICK_MS } from "./vector-bead-recorder-logic";

export type VectorBeadRecordResult = {
  sessionYmd: string;
  total: number;
  recorded: number;
  failed: number;
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
}): Promise<VectorBeadRecordResult> {
  const sessionYmd = opts?.sessionYmd ?? todayEtYmd();
  const started = Date.now();
  if (!sessionYmd) {
    return { sessionYmd: "", total: 0, recorded: 0, failed: 0, elapsedMs: 0 };
  }

  const tickers = await listSharedUniverseTickers();
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
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) recorded += 1;
    else failed += 1;
  }

  return {
    sessionYmd,
    total: tickers.length,
    recorded,
    failed,
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
    return { sessionYmd: "", total: 0, recorded: 0, failed: 0, elapsedMs: 0 };
  }

  const universe = new Set(await listSharedUniverseTickers());
  const { getActiveVectorTickers } = await import("./vector-stream-hub");
  const tickers = getActiveVectorTickers().filter((t) => !universe.has(t));
  if (!tickers.length) {
    return { sessionYmd, total: 0, recorded: 0, failed: 0, elapsedMs: Date.now() - started };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const results = await Promise.allSettled(
    tickers.map((ticker) =>
      recordVectorUniverseWallSample(ticker, { sessionYmd, nowSec, bucketScope: "live" })
    )
  );

  let recorded = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) recorded += 1;
    else failed += 1;
  }

  return {
    sessionYmd,
    total: tickers.length,
    recorded,
    failed,
    elapsedMs: Date.now() - started,
  };
}
