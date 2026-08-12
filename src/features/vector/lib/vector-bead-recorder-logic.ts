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

// ── Sweep budget observability ────────────────────────────────────────────────────────────────

/**
 * How far over its tick budget a sweep must run before it is worth a log line.
 *
 * A sweep that overruns is not an error — it records everything, just late — so nothing in the
 * recorder ever complained about one. That silence is exactly how this defect survived twice.
 * On 2026-08-07 the universe was recording at 10s instead of 5s and it was found only by a member
 * noticing thin beads; the response was to raise `vectorBeadRecordConcurrency` 25 -> 64. By
 * 2026-08-12 it had regressed to ~30s, with the same fingerprint (QQQ/TSLA/AMD all landing on
 * EXACTLY 115 samples over the same window — identical counts because they share one sweep) and
 * again no log line anywhere.
 *
 * Tuning a constant twice without an alarm is how you get a third regression. This is the alarm.
 */
const SWEEP_OVERRUN_FACTOR = 1.5;

/** Don't emit more than one overrun line per this interval — a chronically slow sweep is ONE
 *  fact, and logging it every tick buries the signal it is supposed to raise. */
const SWEEP_OVERRUN_LOG_INTERVAL_MS = 60_000;

export type SweepBudgetState = { lastLoggedAt: number };

export type SweepBudgetVerdict =
  | { kind: "ok" }
  | {
      kind: "overrun";
      /** Sweeps actually achievable per tick budget, i.e. the REAL cadence tickers are getting. */
      effectiveCadenceMs: number;
      elapsedMs: number;
      budgetMs: number;
      recorded: number;
      total: number;
    };

/**
 * Decide whether this sweep's duration is worth reporting, rate-limited.
 *
 * Pure so the threshold and the rate limit are testable without a clock or a leader: the caller
 * passes `nowMs` and owns the mutable `state`.
 *
 * Reports the EFFECTIVE CADENCE rather than raw elapsed, because that is the number a reader
 * needs. "sweep took 31s" invites the response "so what, it finished"; "the universe is recording
 * at 31s, not the designed 5s" names the member-visible consequence — thin bead rails — and is
 * directly comparable to the per-ticker gaps anyone measures off a live rail.
 */
export function evaluateSweepBudget(
  elapsedMs: number,
  budgetMs: number,
  recorded: number,
  total: number,
  nowMs: number,
  state: SweepBudgetState
): SweepBudgetVerdict {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(budgetMs) || budgetMs <= 0) return { kind: "ok" };
  if (elapsedMs <= budgetMs * SWEEP_OVERRUN_FACTOR) return { kind: "ok" };
  if (nowMs - state.lastLoggedAt < SWEEP_OVERRUN_LOG_INTERVAL_MS) return { kind: "ok" };
  state.lastLoggedAt = nowMs;
  // A sweep that overruns forces the leader to drop every tick that lands while it runs, so the
  // achieved cadence rounds UP to whole ticks — 7s of work on a 5s budget yields 10s, not 7s.
  const ticks = Math.max(1, Math.ceil(elapsedMs / budgetMs));
  return {
    kind: "overrun",
    effectiveCadenceMs: ticks * budgetMs,
    elapsedMs: Math.round(elapsedMs),
    budgetMs,
    recorded,
    total,
  };
}

// ── Per-ticker deadline ───────────────────────────────────────────────────────────────────────

/**
 * How long ONE ticker may take before the sweep gives up on it for this tick.
 *
 * Kept under the 5s tick budget on purpose: the deadline exists to protect the TICK, so a bound
 * at or above it would never bind.
 */
export const VECTOR_BEAD_TICKER_DEADLINE_MS = 4_000;

/**
 * Why a per-ticker deadline is the right instrument here.
 *
 * `mapInPool` runs at concurrency 64 while a shard now holds ~25 tickers, so EVERY ticker in a
 * shard starts at once and the sweep ends when the SLOWEST one finishes. Sweep duration is a max,
 * not a sum — which means a single slow name sets the cadence for every other ticker on that
 * shard. Measured on prod 2026-08-12 after sharding landed: slices of 23-25 tickers still took
 * 10-30s, i.e. one ticker was burning tens of seconds while two dozen others sat finished.
 *
 * Raising concurrency cannot help (nothing is queued). Sharding harder cannot help (the slow
 * ticker just lands on a smaller shard and stalls that one instead). The only fix is to stop
 * waiting on the straggler.
 *
 * A timed-out ticker is reported as FAILED, not silently skipped: it produced no sample this tick,
 * which is exactly what `trackTickerFailures` exists to surface — a name that is permanently slow
 * now shows up as DARK instead of quietly halving everyone else's bead density.
 *
 * The abandoned work is NOT cancelled. It has no AbortSignal to thread, and letting it finish is
 * harmless: the bucket time was computed before the call, so a late completion writes the correct
 * bucket rather than a shifted one. What we must not do is start ANOTHER one on top of it, which
 * is what `skipIfInFlight` below prevents.
 */
export function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => T
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return work;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    work.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Guard against piling work onto a ticker that has not finished its PREVIOUS tick.
 *
 * Without this the deadline leaks: a permanently slow name gets a fresh call every 5s while the
 * old ones are still running, so the process accumulates in-flight work forever — trading a
 * cadence bug for a resource leak.
 *
 * Returns a runner that starts `fn` only when the ticker is idle, and reports the skip as a
 * failure so the DARK tracker sees the same thing the deadline path reports.
 */
export function makeInFlightGuard(): {
  run<T>(key: string, fn: () => Promise<T>, onBusy: () => T): Promise<T>;
  size(): number;
} {
  const inFlight = new Set<string>();
  return {
    run<T>(key: string, fn: () => Promise<T>, onBusy: () => T): Promise<T> {
      if (inFlight.has(key)) return Promise.resolve(onBusy());
      inFlight.add(key);
      // Clear on settle — including the deadline path, where the caller resolves early but the
      // underlying work is still running. The key is released when the WORK finishes, not when
      // the deadline fires, which is the whole point.
      const p = fn();
      void p.then(
        () => inFlight.delete(key),
        () => inFlight.delete(key)
      );
      return p;
    },
    size: () => inFlight.size,
  };
}
