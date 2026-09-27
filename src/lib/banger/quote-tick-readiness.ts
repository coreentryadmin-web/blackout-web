/**
 * BANGER LIVE-TICK-LOG READINESS/COVERAGE ASSESSMENT — production TypeScript port of
 * `scripts/audit/lib/banger-live-tick-coverage-eval.mjs` (operator directive 2026-09-27, phase 4:
 * make the readiness/verdict study admin-visible and always-on, not something a session has to
 * remember to run by hand). Same rules, same floors — ported so `GET /api/admin/banger/
 * quote-tick-validation-status` can compute this in-process against real DB reads, with no HTTP
 * round-trip through the audit script's own admin-export routes.
 *
 * TWO REAL BUGS FOUND AND FIXED DURING THIS PORT (both applied here; the `.mjs` original is kept
 * only as an independent offline re-verification tool per its own updated header, not fixed to
 * match — see that file):
 *
 * 1. RTH-UNAWARE INTERIOR-GAP CHECK. The original classified any tick-to-tick gap exceeding
 *    `cadenceMinutes * multiple` as GAPPY using raw wall-clock minutes. `banger-live-sync`'s real
 *    deployed schedule (cron-registry.ts's `schedule_cron_utc`) fires every 5 minutes, 11-21 UTC,
 *    Mon-Fri (weekdays, market hours only) — never overnight, never weekends. A Banger position
 *    routinely holds for several DTE days, so its tick series has a
 *    genuine ~17.5-hour overnight gap (and a ~65-hour weekend gap) between every trading session —
 *    which the raw-wall-clock check would flag as an abnormal outage on EVERY multi-day position,
 *    permanently starving this framework of eligible data. Fixed: a gap is only checked against
 *    the cadence ceiling when it falls WITHIN one ET trading session; a gap that crosses to the
 *    very next real ET trading day (skipping nothing but weekend/holiday) is expected and exempt.
 *    A gap that skips one or more FULL trading days with zero ticks logged on them is still real
 *    and still flagged — this only exempts the ordinary session boundary, not a genuine outage.
 *
 * 2. NO DUPLICATE-TICK OR STALE-QUOTE SAFEGUARD. `banger_quote_tick_log` has no unique constraint
 *    on (contract_occ, polled_at), so a racing/retried cron invocation could in principle log two
 *    rows at the same instant. If their marks disagree, blindly replaying both is a genuine
 *    contamination risk (the state machine would see fabricated tick-to-tick movement that never
 *    happened). Fixed: `assessTickQuality` dedupes same-timestamp rows and, when they disagree by
 *    more than a cent, flags the position as a DUPLICATE_CONFLICT and excludes it from FULL,
 *    rather than silently picking one value. Separately, `reliableMarkFromQuote`'s own backstop-
 *    quote-divergence guard (PR #4969) firing on a LARGE fraction of a position's ticks means the
 *    replay is riding on last-trade fallback marks (not real two-sided quotes) for most of its
 *    life — flagged as BACKSTOP_HEAVY and also excluded from FULL, rather than trusted silently.
 *
 * PURE AND TOTAL: no IO, no clock captured internally (every timestamp is a caller-supplied number
 * or ISO string), no throw.
 */
import { todayEt } from "@/lib/et-date";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import type { BangerQuoteTickCoverageRow, BangerQuoteTickLogRow } from "@/lib/banger/quote-tick-log";

export type ReplayTick = { t: number; mark: number; bid: number };

function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

// ─── ET trading-day arithmetic (bare YYYY-MM-DD strings, UTC-midnight-anchored so DST cannot shift
// the date, same convention `addDays` already uses in the historical adversarial audit script) ────

function addDaysToYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * True iff the gap between two tick instants is fully explained by an ORDINARY session boundary —
 * same ET trading day (not a boundary at all), or `tickBMs`'s ET day is the very next REAL trading
 * day after `tickAMs`'s ET day (only weekend/holiday calendar days skipped, zero real trading days
 * silently missed). False for a same-day gap (the caller applies the normal cadence ceiling to
 * those) and false when one or more full trading days were skipped with no ticks logged on them —
 * that is a real outage, not a boundary.
 */
export function isLegitimateSessionBoundaryGap(tickAMs: number, tickBMs: number, maxDaysToWalk = 30): boolean {
  if (!finite(tickAMs) || !finite(tickBMs) || tickBMs < tickAMs) return false;
  const dayA = todayEt(new Date(tickAMs));
  const dayB = todayEt(new Date(tickBMs));
  if (dayA === dayB) return false;
  let cursor = dayA;
  for (let i = 0; i < maxDaysToWalk; i++) {
    cursor = addDaysToYmd(cursor, 1);
    if (cursor >= dayB) break;
    if (isTradingDayEt(cursor)) return false; // a real trading day was skipped with no ticks -> not legitimate
  }
  return true;
}

// ─── Tick quality: dedupe + backstop-fallback ratio ────────────────────────────────────────────

export type TickQuality = {
  tickCount: number;
  duplicateTimestampCount: number;
  duplicateConflictCount: number;
  backstopFiredCount: number;
  backstopFiredRatio: number | null;
};

const DUPLICATE_MARK_EPSILON = 0.01;

/**
 * Folds raw, ascending `banger_quote_tick_log` rows (ORDER BY polled_at ASC, id ASC) into a
 * replay-ready tick series, deduping same-timestamp rows (later `id` wins — the logically later
 * insert at an identical instant) and reporting the quality signals `assessPositionCoverage` uses
 * to reject contaminated data. A row with no `reliable_mark` is skipped, never fabricated.
 */
export function assessTickQuality(rawRowsAsc: BangerQuoteTickLogRow[]): { quality: TickQuality; cleanedTicks: ReplayTick[] } {
  const cleaned: ReplayTick[] = [];
  let duplicateTimestampCount = 0;
  let duplicateConflictCount = 0;
  let backstopFiredCount = 0;
  let usableCount = 0;

  for (const row of rawRowsAsc) {
    if (!finite(row.reliable_mark)) continue;
    usableCount++;
    if (finite(row.raw_mark) && Math.abs(row.raw_mark - row.reliable_mark) > 1e-9) backstopFiredCount++;
    const t = Date.parse(row.polled_at);
    if (!Number.isFinite(t)) continue;
    const bid = finite(row.bid) ? row.bid : row.reliable_mark;
    const prev = cleaned.at(-1);
    if (prev && prev.t === t) {
      duplicateTimestampCount++;
      if (Math.abs(prev.mark - row.reliable_mark) > DUPLICATE_MARK_EPSILON) duplicateConflictCount++;
      cleaned[cleaned.length - 1] = { t, mark: row.reliable_mark, bid };
      continue;
    }
    cleaned.push({ t, mark: row.reliable_mark, bid });
  }

  return {
    quality: {
      tickCount: usableCount,
      duplicateTimestampCount,
      duplicateConflictCount,
      backstopFiredCount,
      backstopFiredRatio: usableCount > 0 ? backstopFiredCount / usableCount : null,
    },
    cleanedTicks: cleaned,
  };
}

// ─── Per-position coverage classification ──────────────────────────────────────────────────────

export type CoverageBucket =
  | "FULL"
  | "PARTIAL_START"
  | "PARTIAL_END"
  | "PARTIAL_BOTH"
  | "GAPPY"
  | "DUPLICATE_CONFLICT"
  | "BACKSTOP_HEAVY"
  | "NONE";

export type PositionCoverage = {
  coverage: CoverageBucket;
  tickCount: number;
  reasons: string[];
  firstTickAtMs: number | null;
  lastTickAtMs: number | null;
  startGapMinutes: number | null;
  endGapMinutes: number | null;
  maxInteriorGapMinutes: number | null;
  quality: TickQuality | null;
  /** The deduped, replay-ready tick series `assessTickQuality` already built while classifying this
   *  position -- returned so a caller (the admin status route) can feed it straight into
   *  `replayPairTick` without re-parsing/re-deduping the same raw rows a second time. */
  cleanedTicks: ReplayTick[];
};

/** Real deployed cadence for `banger-live-sync` -- every 5 minutes, market hours only (cron-registry.ts's `schedule_cron_utc`). */
export const DEFAULT_CADENCE_MINUTES = 5;
export const DEFAULT_EDGE_TOLERANCE_MINUTES = 25;
export const DEFAULT_INTERIOR_GAP_MULTIPLE = 3;
/** A position whose backstop-fallback (PR #4969) fired on more than half its ticks was riding on
 *  last-trade fallback marks, not real two-sided quotes, for most of its life -- excluded from
 *  FULL rather than trusted silently. Disclosed, round, conservative -- not tuned to any result. */
export const BACKSTOP_HEAVY_RATIO = 0.5;

export function assessPositionCoverage(
  args: { committedAtMs: number; closedAtMs: number; rawTickRows: BangerQuoteTickLogRow[] },
  opts: { cadenceMinutes?: number; edgeToleranceMinutes?: number; interiorGapMultiple?: number } = {},
): PositionCoverage {
  const cadenceMinutes = opts.cadenceMinutes ?? DEFAULT_CADENCE_MINUTES;
  const edgeToleranceMinutes = opts.edgeToleranceMinutes ?? DEFAULT_EDGE_TOLERANCE_MINUTES;
  const interiorGapMultiple = opts.interiorGapMultiple ?? DEFAULT_INTERIOR_GAP_MULTIPLE;
  const { committedAtMs, closedAtMs, rawTickRows } = args;

  if (!finite(committedAtMs) || !finite(closedAtMs) || closedAtMs <= committedAtMs) {
    return { coverage: "NONE", tickCount: 0, reasons: ["invalid_lifecycle_window"], firstTickAtMs: null, lastTickAtMs: null, startGapMinutes: null, endGapMinutes: null, maxInteriorGapMinutes: null, quality: null, cleanedTicks: [] };
  }

  const { quality, cleanedTicks } = assessTickQuality(rawTickRows);
  if (cleanedTicks.length === 0) {
    return { coverage: "NONE", tickCount: 0, reasons: ["no_ticks_in_window"], firstTickAtMs: null, lastTickAtMs: null, startGapMinutes: null, endGapMinutes: null, maxInteriorGapMinutes: null, quality, cleanedTicks: [] };
  }

  const reasons: string[] = [];
  if (quality.duplicateConflictCount > 0) {
    reasons.push(`duplicate_tick_conflict_${quality.duplicateConflictCount}x`);
  }
  if (finite(quality.backstopFiredRatio) && quality.backstopFiredRatio > BACKSTOP_HEAVY_RATIO) {
    reasons.push(`backstop_fallback_ratio_${Math.round(quality.backstopFiredRatio * 100)}pct_exceeds_${Math.round(BACKSTOP_HEAVY_RATIO * 100)}pct`);
  }

  const firstTickAtMs = cleanedTicks[0]!.t;
  const lastTickAtMs = cleanedTicks.at(-1)!.t;
  const startGapMinutes = Math.max(0, (firstTickAtMs - committedAtMs) / 60_000);
  const endGapMinutes = Math.max(0, (closedAtMs - lastTickAtMs) / 60_000);

  let maxInteriorGapMinutes = 0;
  const interiorGapCeiling = cadenceMinutes * interiorGapMultiple;
  for (let i = 1; i < cleanedTicks.length; i++) {
    const gapMinutes = (cleanedTicks[i]!.t - cleanedTicks[i - 1]!.t) / 60_000;
    if (gapMinutes <= interiorGapCeiling) continue;
    if (isLegitimateSessionBoundaryGap(cleanedTicks[i - 1]!.t, cleanedTicks[i]!.t)) continue; // ordinary overnight/weekend -- not counted
    if (gapMinutes > maxInteriorGapMinutes) maxInteriorGapMinutes = gapMinutes;
  }

  const startOk = startGapMinutes <= edgeToleranceMinutes;
  const endOk = endGapMinutes <= edgeToleranceMinutes;
  const interiorOk = maxInteriorGapMinutes <= interiorGapCeiling;
  if (!startOk) reasons.push(`start_gap_${Math.round(startGapMinutes)}min_exceeds_${edgeToleranceMinutes}min`);
  if (!endOk) reasons.push(`end_gap_${Math.round(endGapMinutes)}min_exceeds_${edgeToleranceMinutes}min`);
  if (!interiorOk) reasons.push(`interior_gap_${Math.round(maxInteriorGapMinutes)}min_exceeds_${interiorGapCeiling}min`);

  let coverage: CoverageBucket;
  if (quality.duplicateConflictCount > 0) coverage = "DUPLICATE_CONFLICT";
  else if (finite(quality.backstopFiredRatio) && quality.backstopFiredRatio > BACKSTOP_HEAVY_RATIO) coverage = "BACKSTOP_HEAVY";
  else if (!interiorOk) coverage = "GAPPY";
  else if (!startOk && !endOk) coverage = "PARTIAL_BOTH";
  else if (!startOk) coverage = "PARTIAL_START";
  else if (!endOk) coverage = "PARTIAL_END";
  else coverage = "FULL";

  return {
    coverage,
    tickCount: cleanedTicks.length,
    reasons,
    firstTickAtMs,
    lastTickAtMs,
    startGapMinutes: Math.round(startGapMinutes * 10) / 10,
    endGapMinutes: Math.round(endGapMinutes * 10) / 10,
    maxInteriorGapMinutes: Math.round(maxInteriorGapMinutes * 10) / 10,
    quality,
    cleanedTicks,
  };
}

/** Cheap pre-filter using only the aggregate coverage scan (no per-tick fetch): does this
 *  position's contract have ANY coverage overlapping its lifecycle window at all? */
export function coverageEnvelopeOverlaps(
  args: { committedAtMs: number; closedAtMs: number },
  coverageRow: BangerQuoteTickCoverageRow | undefined,
  edgeToleranceMinutes = DEFAULT_EDGE_TOLERANCE_MINUTES,
): boolean {
  if (!coverageRow || !finite(args.committedAtMs) || !finite(args.closedAtMs)) return false;
  const firstTickAtMs = Date.parse(coverageRow.first_tick_at);
  const lastTickAtMs = Date.parse(coverageRow.last_tick_at);
  if (!Number.isFinite(firstTickAtMs) || !Number.isFinite(lastTickAtMs)) return false;
  const toleranceMs = edgeToleranceMinutes * 60_000;
  return firstTickAtMs <= args.committedAtMs + toleranceMs && lastTickAtMs >= args.closedAtMs - toleranceMs;
}

// ─── Population readiness ───────────────────────────────────────────────────────────────────────

export type ReadinessReport = {
  totalClosedPositionsInWindow: number;
  byBucket: Record<CoverageBucket, number>;
  fullCoverageN: number;
  minVerifiedN: number;
  readyForVerdict: boolean;
  shortfall: number;
};

/** Matches this toolkit's own n>=30 floor elsewhere (helix-score-signal.mjs, swing-score-
 *  calibration.mjs) -- not invented for this study specifically. */
export const DEFAULT_MIN_VERIFIED_N = 30;

const ALL_BUCKETS: CoverageBucket[] = ["FULL", "PARTIAL_START", "PARTIAL_END", "PARTIAL_BOTH", "GAPPY", "DUPLICATE_CONFLICT", "BACKSTOP_HEAVY", "NONE"];

export function buildReadinessReport(coverages: CoverageBucket[], minVerifiedN = DEFAULT_MIN_VERIFIED_N): ReadinessReport {
  const byBucket = Object.fromEntries(ALL_BUCKETS.map((b) => [b, 0])) as Record<CoverageBucket, number>;
  for (const c of coverages) byBucket[c] = (byBucket[c] ?? 0) + 1;
  const fullCoverageN = byBucket.FULL;
  return {
    totalClosedPositionsInWindow: coverages.length,
    byBucket,
    fullCoverageN,
    minVerifiedN,
    readyForVerdict: fullCoverageN >= minVerifiedN,
    shortfall: Math.max(0, minVerifiedN - fullCoverageN),
  };
}

export type EligibilityReadiness = {
  totalClosedPositionsInWindow: number;
  eligibleN: number;
  minVerifiedN: number;
  readyForVerdict: boolean;
  shortfall: number;
};

/**
 * Same n>=minVerifiedN gate as `buildReadinessReport`, but keyed off a caller-computed ELIGIBLE
 * flag rather than the raw tick-coverage bucket -- lets a caller (the admin status route) fold in
 * a cross-check dimension this module doesn't know about (e.g. `quote-tick-verdict.ts`'s
 * `crossCheckScaledFlag`, comparing the replayed `scaled` flag against the real recorded
 * `scaled_already` DB column) without conflating two independent rejection dimensions into one
 * enum. A position is eligible only when BOTH gates pass: FULL tick coverage AND the replay agrees
 * with what the DB actually recorded happened.
 */
export function buildEligibilityReadiness(eligibleFlags: boolean[], minVerifiedN = DEFAULT_MIN_VERIFIED_N): EligibilityReadiness {
  const eligibleN = eligibleFlags.filter(Boolean).length;
  return {
    totalClosedPositionsInWindow: eligibleFlags.length,
    eligibleN,
    minVerifiedN,
    readyForVerdict: eligibleN >= minVerifiedN,
    shortfall: Math.max(0, minVerifiedN - eligibleN),
  };
}

/** Projects days-to-readiness from the OBSERVED rate of new full-coverage closes -- never a
 *  guessed one. Returns null (not Infinity/NaN) when the rate can't yet be measured. */
export function projectDaysToReadiness(fullCoverageN: number, minVerifiedN: number, dailyFullCoverageRate: number | null): number | null {
  const shortfall = minVerifiedN - fullCoverageN;
  if (shortfall <= 0) return 0;
  if (!finite(dailyFullCoverageRate) || dailyFullCoverageRate <= 0) return null;
  return Math.ceil(shortfall / dailyFullCoverageRate);
}
