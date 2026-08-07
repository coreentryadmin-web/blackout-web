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

/**
 * Consecutive failed passes before a ticker is declared DARK.
 *
 * 3 passes at {@link VECTOR_BEAD_RECORD_TICK_MS} (5s) ≈ 15s of missing beads — long enough that a
 * single flaky upstream fetch does not page, short enough that a real outage is named while it is
 * still happening rather than discovered in a post-mortem.
 */
export const TICKER_DARK_THRESHOLD = 3;

export type DarkTickerEvent = {
  ticker: string;
  kind: "dark" | "recovered";
  /** Consecutive failures at the moment the event fired (for "recovered", the streak it ended). */
  consecutive: number;
};

/**
 * Track per-ticker consecutive failures across sweeps and emit EDGE events only.
 *
 * WHY THIS EXISTS: the leader only warned when `recorded === 0` — a whole-pass failure. One ticker
 * failing while the other ~121 succeed produced `recorded=121, failed=1` and logged NOTHING. Live
 * 2026-08-07, ASTS lost ~10 minutes of rail across the opening range and CloudWatch held zero
 * `append failed` / `zero samples recorded` lines for the entire nine-hour session. The outage was
 * real, member-visible as a hole in the bead rail, and completely untraceable after the fact.
 *
 * WHY EDGES AND NOT EVERY FAILURE: this runs every 5s over ~122 tickers. Logging each failure would
 * emit ~120 lines for a single 10-minute outage and make CloudWatch unusable during the exact
 * incident it is meant to illuminate. Emitting only the DARK transition and the RECOVERED
 * transition bounds a 10-minute outage to **two** lines while still capturing when it started, how
 * long it ran, and that it ended.
 *
 * `state` is mutated in place — the caller owns it across ticks (a module-level Map in the leader).
 * Tickers that succeed are removed, so the map stays bounded by the number of CURRENTLY failing
 * names, not by universe size.
 */
export function trackTickerFailures(
  state: Map<string, number>,
  attempted: readonly string[],
  failed: readonly string[],
  threshold = TICKER_DARK_THRESHOLD
): DarkTickerEvent[] {
  const events: DarkTickerEvent[] = [];
  const failedSet = new Set(failed);

  for (const ticker of failed) {
    const next = (state.get(ticker) ?? 0) + 1;
    state.set(ticker, next);
    // Fire ONCE, exactly at the crossing — not on every pass beyond it.
    if (next === threshold) events.push({ ticker, kind: "dark", consecutive: next });
  }

  for (const ticker of attempted) {
    if (failedSet.has(ticker)) continue;
    const prior = state.get(ticker);
    if (prior === undefined) continue;
    // Only announce recovery for a ticker we actually announced as dark.
    if (prior >= threshold) events.push({ ticker, kind: "recovered", consecutive: prior });
    state.delete(ticker);
  }

  return events;
}
