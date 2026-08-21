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
  /**
   * Where the NEXT tick should begin scanning. Pass it back in as `cursor` to round-robin the
   * roster; ignore it and the ceiling starves the same tail forever (see the fairness note below).
   */
  nextCursor: number;
};

/**
 * Decide what to start this tick.
 *
 * ── FAIRNESS, AND THE STARVATION THIS FIXES (2026-08-19) ─────────────────────────────
 * This function used to scan `tickers` from index 0 every tick. That reads as "priority order is
 * respected", and it is — permanently. When the concurrency ceiling BINDS, the same prefix wins
 * every single tick and the same tail is deferred every single tick, forever.
 *
 * Simulated against the shipped defaults (roster 122, limit 64, one RTH session of 5s ticks):
 *
 *     head (1-64)    4680 samples each      <- every tick
 *     tail (65-122)  0 samples each         <- never, not once
 *
 * That is not degradation, it is total starvation of half the universe, and it matches the live
 * measurement that started this: SPX 3964 samples in a session against NVDA 546, QQQ 557, SPY 194,
 * with holes up to 59 minutes. The non-SPX names were not recording slowly — they were recording
 * only in the windows where a universe rebuild happened to reshuffle them into the first 64.
 *
 * The rail then shows exactly what the member reported: SPX draws ~10 strike rows while NVDA draws
 * one, because a row needs samples over time to survive the trail's continuity test.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────
 * Scan CIRCULARLY from `cursor` and hand back `nextCursor`. Priority ordering still decides who
 * goes first WITHIN a tick; it no longer decides who is served across ticks. Every ticker reaches
 * the front within ceil(roster / limit) ticks, so the worst-case cadence becomes bounded and
 * computable instead of infinite.
 *
 * Omitting `cursor` keeps the old index-0 behaviour, which is what the HTTP backup cron and the
 * existing tests rely on — rotation is a property of a REPEATING caller, and a one-shot caller
 * has no next tick to be fair across.
 */
export function selectTickersToRecord(input: {
  tickers: readonly string[];
  /** Tickers whose previous record has not yet settled. */
  inFlight: ReadonlySet<string>;
  /** Max concurrent records across ALL overlapping sweeps. */
  limit: number;
  /** Roster index to begin scanning at. Feed the previous decision's `nextCursor` back in. */
  cursor?: number;
}): ScheduleDecision {
  const start: string[] = [];
  const busy: string[] = [];
  const deferred: string[] = [];

  const limit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 1;
  // Slots already consumed by records still running from earlier ticks. Counting them is what makes
  // the ceiling global instead of per-sweep.
  let free = Math.max(0, limit - input.inFlight.size);
  const seen = new Set<string>();

  const roster = input.tickers ?? [];
  const n = roster.length;
  // Normalise defensively: a caller that has been running for hours will hand back a large cursor,
  // and a roster that shrank between ticks must not throw or silently skip the head.
  const rawCursor = Number.isFinite(input.cursor) ? Math.floor(input.cursor as number) : 0;
  const startAt = n > 0 ? ((rawCursor % n) + n) % n : 0;
  // Advance from where we began, so a tick that starts nothing still moves the roster on rather
  // than re-offering the same busy prefix next time.
  let nextCursor = startAt;
  const ordered = n > 0 ? Array.from({ length: n }, (_, i) => roster[(startAt + i) % n]!) : [];

  for (const raw of ordered) {
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
    // Next tick resumes just past the last ticker we actually STARTED. Resuming past the ones we
    // merely skipped would march the cursor over a busy name and cost it its next turn too.
    nextCursor = (startAt + start.length + busy.length) % (n || 1);
  }

  return { start, busy, deferred, nextCursor };
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
