/**
 * LIVE-TICK-LOG READINESS/COVERAGE ASSESSMENT (operator directive 2026-09-27, phase 3: use
 * `banger_quote_tick_log` — production's OWN captured live polling tape (PR #5522) — as the source
 * of truth for a future Banger exit-rule validation, instead of the archived Polygon reconstruction
 * that PR #5521/#5522 showed can disagree with what production's live poll actually saw at the
 * exact decision instant.
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM THE REPLAY ENGINE: `banger-quote-tick-replay-eval.mjs`
 * answers "what does this exit rule do, GIVEN a tick series" — it has no opinion on whether that
 * tick series is trustworthy. This module answers the prior question this framework needs before
 * trusting ANY replay result: does a closed position's tick coverage actually SPAN its real
 * lifecycle (entry to exit), with no gap large enough to have silently missed the exact tick that
 * decided its outcome? A position whose logging started mid-lifecycle, or whose cron missed several
 * consecutive ticks, must be excluded from any verdict, not silently included with a wrong replay.
 *
 * NO TUNING AGAINST THIN DATA: this module NEVER lowers its own coverage bar to manufacture a
 * bigger "ready" population — a position either demonstrably had full, gap-bounded coverage across
 * its committed→closed window, or it did not. The framework this feeds is explicitly a readiness
 * gate, not an accuracy dial.
 *
 * PURE AND TOTAL: no IO, no clock (every timestamp is a caller-supplied epoch-ms number), no throw.
 */

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/** Maps one `banger_quote_tick_log` row (as returned by the admin export route) to the
 *  `{t, mark, bid}` shape `replayTickState`/`replayPairTick` consume. Returns null for an
 *  unusable tick (no `reliable_mark` — production itself could not resolve a trustworthy mark at
 *  that instant) rather than fabricating one; the caller filters nulls out. */
export function mapDbTickToReplayTick(row) {
  if (!row || !finite(row.reliable_mark)) return null;
  const t = Date.parse(row.polled_at);
  if (!Number.isFinite(t)) return null;
  return { t, mark: row.reliable_mark, bid: finite(row.bid) ? row.bid : row.reliable_mark };
}

/** Maps + filters an ascending array of raw DB tick rows into a replay-ready series, preserving
 *  order (the export route already sorts `ORDER BY polled_at ASC, id ASC`). */
export function ticksToReplaySeries(rows) {
  return (rows ?? []).map(mapDbTickToReplayTick).filter((t) => t !== null);
}

/**
 * Assesses whether ONE closed position's logged ticks actually cover its real lifecycle.
 *
 * `committedAtMs`/`closedAtMs`: the position's real entry/exit instants (epoch ms).
 * `ticks`: this position's own `{t, mark, bid}` series, already windowed to its contract (the
 *   caller fetches per-contract via `fetchBangerQuoteTicksForContract`/the detail export mode —
 *   this function does no filtering by contract itself).
 * `cadenceMinutes`: the cron's real polling cadence during RTH (banger-live-sync fires on the
 *   ~15-20min zerodte-warm/desk-warm cadence per that route's own header) — used only to size what
 *   counts as an abnormal interior gap (a missed tick or two is tolerated; a long silent stretch
 *   is not).
 * `edgeToleranceMinutes`: how close to the true entry/exit instant the first/last tick must land
 *   to count as "covering the edge" — generous by design (a position can commit/close between
 *   polling cadences with no coverage gap implied), NOT tightened over time to manufacture a
 *   bigger ready population.
 */
export function assessPositionCoverage(
  { committedAtMs, closedAtMs, ticks },
  { cadenceMinutes = 20, edgeToleranceMinutes = 25, interiorGapMultiple = 3 } = {},
) {
  const series = (ticks ?? []).filter((t) => t && finite(t.t) && finite(t.mark));
  const reasons = [];

  if (!finite(committedAtMs) || !finite(closedAtMs) || closedAtMs <= committedAtMs) {
    return { coverage: "NONE", tickCount: series.length, reasons: ["invalid_lifecycle_window"], firstTickAtMs: null, lastTickAtMs: null, startGapMinutes: null, endGapMinutes: null, maxInteriorGapMinutes: null };
  }

  if (series.length === 0) {
    return { coverage: "NONE", tickCount: 0, reasons: ["no_ticks_in_window"], firstTickAtMs: null, lastTickAtMs: null, startGapMinutes: null, endGapMinutes: null, maxInteriorGapMinutes: null };
  }

  const firstTickAtMs = series[0].t;
  const lastTickAtMs = series.at(-1).t;
  const startGapMinutes = Math.max(0, (firstTickAtMs - committedAtMs) / 60_000);
  const endGapMinutes = Math.max(0, (closedAtMs - lastTickAtMs) / 60_000);

  let maxInteriorGapMinutes = 0;
  for (let i = 1; i < series.length; i++) {
    const gap = (series[i].t - series[i - 1].t) / 60_000;
    if (gap > maxInteriorGapMinutes) maxInteriorGapMinutes = gap;
  }

  const interiorGapCeiling = cadenceMinutes * interiorGapMultiple;
  const startOk = startGapMinutes <= edgeToleranceMinutes;
  const endOk = endGapMinutes <= edgeToleranceMinutes;
  const interiorOk = maxInteriorGapMinutes <= interiorGapCeiling;

  if (!startOk) reasons.push(`start_gap_${Math.round(startGapMinutes)}min_exceeds_${edgeToleranceMinutes}min`);
  if (!endOk) reasons.push(`end_gap_${Math.round(endGapMinutes)}min_exceeds_${edgeToleranceMinutes}min`);
  if (!interiorOk) reasons.push(`interior_gap_${Math.round(maxInteriorGapMinutes)}min_exceeds_${interiorGapCeiling}min`);

  let coverage;
  if (startOk && endOk && interiorOk) coverage = "FULL";
  else if (!interiorOk) coverage = "GAPPY";
  else if (!startOk && !endOk) coverage = "PARTIAL_BOTH";
  else if (!startOk) coverage = "PARTIAL_START";
  else coverage = "PARTIAL_END";

  return { coverage, tickCount: series.length, reasons, firstTickAtMs, lastTickAtMs, startGapMinutes: Math.round(startGapMinutes * 10) / 10, endGapMinutes: Math.round(endGapMinutes * 10) / 10, maxInteriorGapMinutes: Math.round(maxInteriorGapMinutes * 10) / 10 };
}

/**
 * Cheap PRE-FILTER using only the aggregate coverage scan (no per-tick fetch): does this
 * position's contract have ANY logged coverage overlapping its lifecycle window at all? A position
 * that fails this can be skipped without ever paying for a detail fetch — it is provably NONE.
 * A position that PASSES still needs `assessPositionCoverage` against the real per-tick series to
 * confirm no interior gap (this check cannot see interior gaps, only the aggregate envelope).
 */
export function coverageEnvelopeOverlaps(
  { committedAtMs, closedAtMs },
  coverageRow,
  { edgeToleranceMinutes = 25 } = {},
) {
  if (!coverageRow || !finite(committedAtMs) || !finite(closedAtMs)) return false;
  const firstTickAtMs = Date.parse(coverageRow.first_tick_at);
  const lastTickAtMs = Date.parse(coverageRow.last_tick_at);
  if (!Number.isFinite(firstTickAtMs) || !Number.isFinite(lastTickAtMs)) return false;
  const toleranceMs = edgeToleranceMinutes * 60_000;
  return firstTickAtMs <= committedAtMs + toleranceMs && lastTickAtMs >= closedAtMs - toleranceMs;
}

/**
 * Aggregates per-position coverage assessments into a readiness verdict. `minVerifiedN` is a
 * documented floor, not a computed one — this repo's own toolkit convention (helix-score-signal.mjs,
 * swing-score-calibration.mjs) refuses a verdict below n=30 real paired observations; this framework
 * applies the SAME floor rather than inventing a bespoke one for this table.
 */
export function buildReadinessReport(assessedPositions, { minVerifiedN = 30 } = {}) {
  const byBucket = { FULL: 0, PARTIAL_START: 0, PARTIAL_END: 0, PARTIAL_BOTH: 0, GAPPY: 0, NONE: 0 };
  for (const p of assessedPositions ?? []) {
    const bucket = p.coverage?.coverage ?? "NONE";
    byBucket[bucket] = (byBucket[bucket] ?? 0) + 1;
  }
  const fullCoverageN = byBucket.FULL;
  const totalN = (assessedPositions ?? []).length;
  return {
    totalClosedPositionsInWindow: totalN,
    byBucket,
    fullCoverageN,
    minVerifiedN,
    readyForVerdict: fullCoverageN >= minVerifiedN,
    shortfall: Math.max(0, minVerifiedN - fullCoverageN),
  };
}

/**
 * Projects how much longer, at the OBSERVED rate of new full-coverage closes, until `minVerifiedN`
 * is reached — so a future session knows WHEN to re-run this framework instead of guessing.
 * `dailyFullCoverageRate` must be measured by the caller from real data (full-coverage closes
 * since the log's own start date, divided by elapsed days) — this function never invents a rate.
 * Returns null (not Infinity/NaN) when the rate is non-positive or data is too thin to project —
 * an honest "cannot project yet" rather than a fabricated ETA.
 */
export function projectDaysToReadiness(fullCoverageN, minVerifiedN, dailyFullCoverageRate) {
  const shortfall = minVerifiedN - fullCoverageN;
  if (shortfall <= 0) return 0;
  if (!finite(dailyFullCoverageRate) || dailyFullCoverageRate <= 0) return null;
  return Math.ceil(shortfall / dailyFullCoverageRate);
}
