/**
 * Per-ticker bead scheduling — which tickers a tick may start, given what is still running.
 *
 * ── THE ARCHITECTURAL GAP THIS CLOSES ────────────────────────────────────────────────
 * The leader fires every 5s and guarded the whole SWEEP: `if (recordInFlight) return`. One shared
 * sweep covers all ~122 tickers, so a single slow name held the guard and the entire next tick was
 * dropped — for every ticker, including the 121 that were ready. The achieved cadence became
 * `ceil(sweepMs / 5s) × 5s`, which `evaluateSweepBudget` already computes and logs. The system knew
 * it was degrading; it just had no way to stop.
 *
 * Measured on prod 2026-08-18: blended-rail median gap 60s on TSLA/META/AAPL/AMD against a 5s spec,
 * 95-167 gaps over 30s per ticker, and holes of 1080s and 1190s. The same failure is on record from
 * 2026-08-07, when AMD/TSLA/IWM/META/AAPL/QQQ each logged EXACTLY 190 samples over 1,610s —
 * identical counts precisely because they all ride one sweep. The response then was to raise
 * concurrency 25 -> 64, which moved the threshold rather than removing it, and the drift has since
 * crossed it again.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────
 * Guard the TICKER, not the sweep. A ticker whose previous record is still running skips this tick
 * and only this tick; every other ticker proceeds on schedule. A slow name now throttles itself
 * instead of the universe.
 *
 * `limit` is still enforced, and enforced GLOBALLY across overlapping sweeps rather than per call —
 * without that, allowing overlap would multiply concurrent upstream reads by the number of sweeps
 * in flight, which is how a fix for a latency problem becomes a load problem.
 *
 * ── WHY SKIPS ARE COUNTED, NOT SWALLOWED ─────────────────────────────────────────────
 * A dropped tick used to be invisible: the old guard returned before anything was recorded or
 * logged. Every skip here is returned to the caller so a ticker that is persistently busy shows up
 * as a number instead of as a hole in a chart that someone has to notice by eye.
 */

export type ScheduleDecision = {
  /** Tickers this tick should start recording now. */
  start: string[];
  /** Tickers skipped because their previous record is STILL RUNNING. Self-throttling, expected. */
  busy: string[];
  /** Tickers skipped because the global concurrency ceiling was already reached this tick. */
  deferred: string[];
};

/**
 * Decide what to start this tick.
 *
 * Order is preserved from `tickers`, so the caller's ordering (sharding, priority) still decides
 * who gets the remaining slots when the ceiling binds — the scheduler must not silently reshuffle
 * a roster someone else deliberately ordered.
 */
export function selectTickersToRecord(input: {
  tickers: readonly string[];
  /** Tickers whose previous record has not yet settled. */
  inFlight: ReadonlySet<string>;
  /** Max concurrent records across ALL overlapping sweeps. */
  limit: number;
}): ScheduleDecision {
  const start: string[] = [];
  const busy: string[] = [];
  const deferred: string[] = [];

  const limit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 1;
  // Slots already consumed by records still running from earlier ticks. Counting them is what makes
  // the ceiling global instead of per-sweep.
  let free = Math.max(0, limit - input.inFlight.size);
  const seen = new Set<string>();

  for (const raw of input.tickers ?? []) {
    const ticker = String(raw ?? "").trim().toUpperCase();
    if (!ticker) continue;
    // A roster that repeats a ticker must not start it twice in one tick — that would be two
    // concurrent records of the same rail, i.e. the duplicate-append problem in a new place.
    if (seen.has(ticker)) continue;
    seen.add(ticker);

    if (input.inFlight.has(ticker)) {
      busy.push(ticker);
      continue;
    }
    if (free <= 0) {
      deferred.push(ticker);
      continue;
    }
    start.push(ticker);
    free -= 1;
  }

  return { start, busy, deferred };
}

/**
 * Did this tick achieve full coverage?
 *
 * Separated from the decision so the caller can alarm on sustained partial coverage without
 * re-deriving the arithmetic. Full coverage means every ticker either started or was already
 * running — a `deferred` list is the ceiling binding, which is the condition worth watching.
 */
export function isFullCoverage(decision: ScheduleDecision): boolean {
  return decision.deferred.length === 0;
}
