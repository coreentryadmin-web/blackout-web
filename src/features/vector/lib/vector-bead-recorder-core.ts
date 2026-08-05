import { todayEtYmd } from "@/lib/providers/spx-session";
import { listSharedUniverseTickers } from "./vector-dynamic-universe";
import { recordVectorUniverseWallSample } from "./vector-universe";
import {
  mapInChunks,
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

  const results = await mapInChunks(tickers, concurrency, (ticker) =>
    recordVectorUniverseWallSample(ticker, { sessionYmd, nowSec })
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
