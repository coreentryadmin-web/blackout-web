/** Wall bead trail sample cadence — shared universe (~100 tickers), viewer or not. */
export const VECTOR_BEAD_RECORD_TICK_MS = 5_000;

/** Active non-universe tickers (live Vector SSE viewers) — 15s bead persistence. */
export const VECTOR_BEAD_RECORD_ACTIVE_TICK_MS = 15_000;

/**
 * Parallel heatmap reads per sweep (Polygon cache-first; tune via env on prod).
 *
 * Raised 25 → 64 (cap 50 → 128) because the sweep has a HARD DEADLINE it was missing: the leader
 * fires every {@link VECTOR_BEAD_RECORD_TICK_MS} (5s) and drops any tick that lands while the
 * previous sweep is still running (`recordInFlight` in vector-bead-recorder-leader.ts). The shared
 * universe is the ~22-name static allowlist PLUS up to `DYNAMIC_UNIVERSE_CAP` = 100 dynamic names,
 * so at 25-wide the sweep needed five passes over ~122 tickers and routinely ran past 5s — every
 * other tick was discarded and the whole universe recorded at 10s instead of the designed 5s.
 * Measured live 2026-08-07 09:56 ET: AMD/TSLA/IWM/META/AAPL/QQQ each had exactly 190 samples over
 * 1,610s of RTH (~322 expected at 5s), median gap 10s, max 30s — identical counts because they all
 * ride this one sweep. SPY/SPX read 5s only because oracle tickers are ALSO topped up by the live
 * SSE scope, which masked the defect on precisely the two tickers most people check.
 *
 * The ceiling is a real bound, not decoration: these are cache-first reads, but a cold universe at
 * 128-wide is still 128 concurrent upstream fetches.
 */
export function vectorBeadRecordConcurrency(): number {
  const raw = process.env.VECTOR_BEAD_RECORD_CONCURRENCY?.trim();
  const n = raw ? Number(raw) : 64;
  return Number.isFinite(n) && n >= 1 ? Math.min(128, Math.floor(n)) : 64;
}

/**
 * Run `fn` over `items` with at most `limit` in flight AT ANY INSTANT — a rolling pool, not
 * fixed-size batches.
 *
 * This replaces a chunked implementation that awaited `Promise.allSettled` on each slice before
 * starting the next. That shape has a straggler barrier per chunk: a slice finishes only when its
 * SLOWEST member does, so the sweep cost was ~Σ(max latency per chunk) rather than
 * ~(N / limit) × average latency. With five chunks that meant paying five worst-case tails every
 * 5s, which is what pushed the sweep past the leader's tick budget.
 *
 * A rolling pool starts the next item the moment ANY worker frees up, so one slow ticker delays
 * only itself instead of stalling the 24 names queued behind it.
 *
 * Results stay INDEX-ALIGNED with `items` despite out-of-order completion — callers that pair
 * results back to tickers (and the tests) depend on that, and a pool that returned completion order
 * would silently mis-attribute failures to the wrong symbol.
 */
export async function mapInPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]!) };
      } catch (reason) {
        // Mirrors Promise.allSettled: one bad ticker must never abort the sweep.
        out[i] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return out;
}

/**
 * @deprecated Use {@link mapInPool} — this awaits each chunk to completion, so every slice pays its
 * slowest member. Kept because it is a pure helper with its own tests and other callers may rely on
 * the batching semantics; the bead recorder no longer does.
 */
export async function mapInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  const size = Math.max(1, chunkSize);
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    out.push(...chunkResults);
  }
  return out;
}
