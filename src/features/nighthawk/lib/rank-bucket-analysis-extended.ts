/**
 * Night Hawk Legacy — rank-bucket diagnostic, EXTENDED (2026-09-21).
 *
 * The base module (`rank-bucket-analysis.ts`) already answers "do ranks 1-5 forward-perform
 * better than 6-10/11-25/rejected" with mean/median h1/eod, mean MFE/MAE, a binary win rate, and
 * a coarse regime-multiplier bucket. This file adds exactly what a direct code review confirmed
 * was missing before any deeper claim could be made: median MFE/MAE, an MFE:MAE ratio, a
 * large-winner/large-loser tail rate, normal-approximation confidence intervals, a Spearman
 * rank<->outcome correlation, direction/conviction/setup-type/fuller-regime segmentation, and a
 * counterfactual "rejected winner / Top-5 loser" tracer.
 *
 * Kept as a SEPARATE file from rank-bucket-analysis.ts on purpose — the base module stays exactly
 * as tested (only its `bucketForRank` doc comment was corrected; two previously-private helpers,
 * `signAlignedReading`/`directionOf`, were exported unchanged so this file can reuse the identical
 * sign-alignment logic rather than risk a second, divergent implementation).
 *
 * PURE, no I/O — same contract as the base module: every function here takes rows a caller already
 * fetched via `fetchNighthawkCandidateSnapshotsInRange` and returns data, never fetches anything
 * itself. LOW-N HONESTY carries through unchanged: every new stat is null (never fabricated) below
 * its own disclosed minimum sample size.
 *
 * GENUINE DATA GAPS, confirmed by reading the pipeline directly, not assumed:
 * - DTE/expiry is not captured anywhere in `nighthawk_candidate_snapshot` at any stage as of
 *   2026-09-21 (see Workstream C of the standing Legacy plan for the fix) — there is no DTE
 *   breakdown here because there is nothing to break down.
 * - "Setup type" is not an official field on ScoredCandidate/PlaybookPlay anywhere in this
 *   pipeline. `classifySetupTypeHeuristic` below is a DERIVED, best-effort label (whichever score
 *   component dominates `snapshot_json.components`) and reports "unknown" honestly wherever that
 *   object isn't present — which is most `rank_final` rows and most STAGE-6 rejected rows today,
 *   since only `scored`/`rank_governor`/governor-rejected rows carry the full component
 *   breakdown. Never presented as an official field.
 * - "Rejected winner" tracing cannot use a literal historical rank for governor/STAGE-6 rejects —
 *   `rank` is unconditionally null for those (see the corrected doc comment on `bucketForRank` in
 *   the base module) — so it instead compares the rejected row's own `score` (always populated
 *   there) against that same edition's real published scores, an honest counterfactual proxy,
 *   never presented as the literal rank the candidate would have held.
 */

import type { NighthawkCandidateSnapshotRow } from "@/lib/db";
import {
  bucketForRank,
  computeRankBucketStats,
  signAlignedReading,
  directionOf,
  RANK_BUCKET_LOW_N_THRESHOLD,
  type RankBucketKey,
  type RankBucketStats,
  type Direction,
} from "./rank-bucket-analysis";

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return Math.round(m * 100) / 100;
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Median MFE/MAE, MFE:MAE ratio, tail rate, confidence intervals
// ─────────────────────────────────────────────────────────────────────────────

/** A >=10% (or <=-10%) sign-aligned EOD move counts as "large." Disclosed, not backtested or
 *  calibrated — a coarse, documented bar, adjustable by any caller that wants a different one via
 *  the `largeMoveThresholdPct` option on `computeExtendedRankBucketStats`. */
export const DEFAULT_LARGE_MOVE_THRESHOLD_PCT = 10;

/** Same low-n bar as the rest of this diagnostic (`RANK_BUCKET_LOW_N_THRESHOLD`) — a correlation
 *  needs at least this many (rank, outcome) pairs before `rho` is reported instead of `null`. */
export const CORRELATION_MIN_N = RANK_BUCKET_LOW_N_THRESHOLD;

export type ConfidenceInterval95 = { low: number; high: number };

export type ExtendedRankBucketStats = RankBucketStats & {
  median_mfe_pct: number | null;
  median_mae_pct: number | null;
  /** |median favorable excursion| / |median adverse excursion| — a rough reward:risk read per
   *  bucket. Null when the median adverse excursion is 0 or unavailable (division would be
   *  meaningless), never coerced to a fake number. */
  mfe_mae_ratio: number | null;
  /** Share of graded rows whose sign-aligned EOD move was >= the large-move threshold. */
  large_winner_rate_pct: number | null;
  /** Share of graded rows whose sign-aligned EOD move was <= -(the large-move threshold). */
  large_loser_rate_pct: number | null;
  /** Normal-approximation 95% CI on win_rate_eod_pct — genuinely WIDE at low n, never hidden. */
  win_rate_eod_ci95: ConfidenceInterval95 | null;
  /** Normal-approximation 95% CI on mean_eod_pct. */
  mean_eod_ci95: ConfidenceInterval95 | null;
};

function confidenceIntervalForProportion(pPct: number | null, n: number): ConfidenceInterval95 | null {
  if (pPct == null || n < 2) return null;
  const p = pPct / 100;
  const se = Math.sqrt((p * (1 - p)) / n);
  const margin = 1.96 * se;
  return { low: round1(Math.max(0, p - margin) * 100), high: round1(Math.min(1, p + margin) * 100) };
}

function confidenceIntervalForMean(values: number[]): ConfidenceInterval95 | null {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = stddev(values);
  if (sd == null) return null;
  const margin = 1.96 * (sd / Math.sqrt(values.length));
  return { low: round2(m - margin), high: round2(m + margin) };
}

export function computeExtendedRankBucketStats(
  rows: readonly NighthawkCandidateSnapshotRow[],
  opts: { largeMoveThresholdPct?: number } = {}
): ExtendedRankBucketStats[] {
  const threshold = opts.largeMoveThresholdPct ?? DEFAULT_LARGE_MOVE_THRESHOLD_PCT;
  const base = computeRankBucketStats(rows);
  const byBucket = new Map<RankBucketKey, NighthawkCandidateSnapshotRow[]>();
  for (const b of base) byBucket.set(b.bucket, []);
  for (const row of rows) byBucket.get(bucketForRank(row.rank))!.push(row);

  return base.map((b) => {
    const bucketRows = byBucket.get(b.bucket)!;
    const readings = bucketRows.map(signAlignedReading).filter((r) => r.eod != null || r.h1 != null);
    const eodValues = readings.map((r) => r.eod).filter((v): v is number => v != null);
    const mfeValues = readings.map((r) => r.mfe).filter((v): v is number => v != null);
    const maeValues = readings.map((r) => r.mae).filter((v): v is number => v != null);

    const medianMfe = median(mfeValues);
    const medianMae = median(maeValues);
    const mfeMaeRatio =
      medianMfe != null && medianMae != null && medianMae !== 0
        ? round2(Math.abs(medianMfe) / Math.abs(medianMae))
        : null;

    const largeWinners = eodValues.filter((v) => v >= threshold).length;
    const largeLosers = eodValues.filter((v) => v <= -threshold).length;

    return {
      ...b,
      median_mfe_pct: medianMfe,
      median_mae_pct: medianMae,
      mfe_mae_ratio: mfeMaeRatio,
      large_winner_rate_pct: eodValues.length ? round1((largeWinners / eodValues.length) * 100) : null,
      large_loser_rate_pct: eodValues.length ? round1((largeLosers / eodValues.length) * 100) : null,
      win_rate_eod_ci95: confidenceIntervalForProportion(b.win_rate_eod_pct, eodValues.length),
      mean_eod_ci95: confidenceIntervalForMean(eodValues),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Spearman rank <-> outcome correlation
// ─────────────────────────────────────────────────────────────────────────────

export type OutcomeMeasure = "h1" | "eod" | "mfe" | "mae";

export type RankOutcomeCorrelation = {
  measure: OutcomeMeasure;
  n: number;
  /** Spearman's rho, -1..1. Null below CORRELATION_MIN_N or when either side has zero variance —
   *  never fabricated as 0. */
  rho: number | null;
  low_n: boolean;
  reason: string | null;
};

/** Average-rank transform (ties share the mean of the ranks they'd otherwise occupy) — the
 *  standard input Spearman's rho needs before a plain Pearson correlation is computed on it. */
function rankTransform(values: number[]): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]!] === values[order[i]!]) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based
    for (let k = i; k <= j; k++) ranks[order[k]!] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null; // no variance on one side -- correlation is undefined, not 0
  return num / Math.sqrt(dx2 * dy2);
}

/** Correlates a row's own `rank` column against a sign-aligned outcome measure, over rows that
 *  carry BOTH a real (non-null) rank AND a graded reading for that measure — a row missing either
 *  is silently excluded from `n`, never imputed. */
export function computeRankOutcomeCorrelation(
  rows: readonly NighthawkCandidateSnapshotRow[],
  measure: OutcomeMeasure
): RankOutcomeCorrelation {
  const pairs: Array<{ rank: number; value: number }> = [];
  for (const row of rows) {
    if (row.rank == null) continue;
    const value = signAlignedReading(row)[measure];
    if (value == null) continue;
    pairs.push({ rank: row.rank, value });
  }

  if (pairs.length < CORRELATION_MIN_N) {
    return {
      measure,
      n: pairs.length,
      rho: null,
      low_n: true,
      reason: `fewer than ${CORRELATION_MIN_N} rows with both a real rank and a graded ${measure} reading`,
    };
  }

  const rankRanks = rankTransform(pairs.map((p) => p.rank));
  const valueRanks = rankTransform(pairs.map((p) => p.value));
  const rho = pearsonCorrelation(rankRanks, valueRanks);

  return {
    measure,
    n: pairs.length,
    rho: rho == null ? null : Math.round(rho * 1000) / 1000,
    low_n: false,
    reason: rho == null ? "no variance in rank or outcome values -- correlation is undefined" : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Direction / conviction / heuristic setup-type / fuller-regime segmentation
// ─────────────────────────────────────────────────────────────────────────────

type SegmentStats<TKey extends string> = {
  key: TKey;
  n: number;
  n_graded: number;
  mean_eod_pct: number | null;
  median_eod_pct: number | null;
  win_rate_eod_pct: number | null;
  low_n: boolean;
};

function segmentStatsFor<TKey extends string>(
  order: readonly TKey[],
  keyFor: (row: NighthawkCandidateSnapshotRow) => TKey
): (rows: readonly NighthawkCandidateSnapshotRow[]) => SegmentStats<TKey>[] {
  return (rows) => {
    const byKey = new Map<TKey, NighthawkCandidateSnapshotRow[]>();
    for (const k of order) byKey.set(k, []);
    for (const row of rows) {
      const k = keyFor(row);
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(row);
    }
    return [...byKey.keys()].map((key) => {
      const segRows = byKey.get(key)!;
      const readings = segRows.map(signAlignedReading).filter((r) => r.eod != null);
      const eodValues = readings.map((r) => r.eod).filter((v): v is number => v != null);
      const winCount = eodValues.filter((v) => v > 0).length;
      return {
        key,
        n: segRows.length,
        n_graded: readings.length,
        mean_eod_pct: mean(eodValues),
        median_eod_pct: median(eodValues),
        win_rate_eod_pct: eodValues.length ? round1((winCount / eodValues.length) * 100) : null,
        low_n: readings.length < RANK_BUCKET_LOW_N_THRESHOLD,
      };
    });
  };
}

export type DirectionKey = Direction | "unknown";
export type DirectionBucketStats = SegmentStats<DirectionKey>;
const DIRECTION_ORDER: DirectionKey[] = ["long", "short", "unknown"];

/** Segments by CALL/PUT (long/short) — every stats field is already sign-aligned per row's own
 *  direction, so this answers "does one direction's thesis play out more often than the other's,"
 *  not "are raw underlying moves bigger for one side." */
export const computeDirectionBucketStats = segmentStatsFor(DIRECTION_ORDER, (row) => (directionOf(row) ?? "unknown") as DirectionKey);

export type ConvictionKey = "A" | "B" | "C" | "unknown";
const CONVICTION_ORDER: ConvictionKey[] = ["A", "B", "C", "unknown"];

function convictionOf(row: NighthawkCandidateSnapshotRow): ConvictionKey {
  const c = row.snapshot_json?.conviction;
  return c === "A" || c === "B" || c === "C" ? c : "unknown";
}

export const computeConvictionBucketStats = segmentStatsFor(CONVICTION_ORDER, convictionOf);

export type TrendRegimeKey = "up" | "down" | "neutral" | "unknown";
const TREND_REGIME_ORDER: TrendRegimeKey[] = ["up", "down", "neutral", "unknown"];

/** Builds a `${edition_for}|${ticker}` -> discovery-stage-row index from a separately-fetched set
 *  of `discovery`-stage rows (the ONLY stage that carries the full `market_regime` object — every
 *  later stage only keeps the scalar `regime_multiplier`). Pass the result to
 *  `computeTrendRegimeBucketStats` for the fuller up/down/neutral read `regimeBucketFor`'s coarse
 *  multiplier bands can't give you. */
export function buildDiscoveryRowIndex(
  discoveryRows: readonly NighthawkCandidateSnapshotRow[]
): ReadonlyMap<string, NighthawkCandidateSnapshotRow> {
  const map = new Map<string, NighthawkCandidateSnapshotRow>();
  for (const row of discoveryRows) {
    map.set(`${row.edition_for}|${row.ticker}`, row);
  }
  return map;
}

type MarketRegimeShape = { trend?: string | null };

/** Segments `rows` (any stage) by the fuller `market_regime.trend` categorical, joined from a
 *  separately-fetched discovery-stage index (see `buildDiscoveryRowIndex`). A row with no
 *  matching discovery-stage sibling — or whose sibling's `market_regime` is absent — buckets
 *  "unknown," never guessed. */
export function computeTrendRegimeBucketStats(
  rows: readonly NighthawkCandidateSnapshotRow[],
  discoveryByKey: ReadonlyMap<string, NighthawkCandidateSnapshotRow>
): SegmentStats<TrendRegimeKey>[] {
  const keyFor = (row: NighthawkCandidateSnapshotRow): TrendRegimeKey => {
    const discoveryRow = discoveryByKey.get(`${row.edition_for}|${row.ticker}`);
    const regime = discoveryRow?.snapshot_json?.market_regime as MarketRegimeShape | undefined;
    const trend = regime?.trend;
    return trend === "up" || trend === "down" || trend === "neutral" ? trend : "unknown";
  };
  return segmentStatsFor(TREND_REGIME_ORDER, keyFor)(rows);
}

export type SetupTypeKey =
  | "flow_led"
  | "technical_led"
  | "positioning_led"
  | "smart_money_led"
  | "catalyst_or_news_led"
  | "balanced"
  | "unknown";

const SETUP_TYPE_ORDER: SetupTypeKey[] = [
  "flow_led",
  "technical_led",
  "positioning_led",
  "smart_money_led",
  "catalyst_or_news_led",
  "balanced",
  "unknown",
];

/** When the top two component scores are within this margin of each other, the row is labeled
 *  "balanced" rather than arbitrarily crediting whichever happened to be marginally larger. */
export const SETUP_TYPE_BALANCED_MARGIN = 2;

const COMPONENT_LABELS: ReadonlyArray<{ key: string; label: SetupTypeKey }> = [
  { key: "flow_score", label: "flow_led" },
  { key: "tech_score", label: "technical_led" },
  { key: "pos_score", label: "positioning_led" },
  { key: "smart_money_score", label: "smart_money_led" },
  { key: "news_score", label: "catalyst_or_news_led" },
];

/** DERIVED, heuristic label — NOT an official field (none exists on ScoredCandidate/PlaybookPlay
 *  anywhere in this pipeline as of 2026-09-21). Labels a row by whichever score component in
 *  `snapshot_json.components` is strictly largest, "balanced" when the top two are within
 *  SETUP_TYPE_BALANCED_MARGIN, and "unknown" whenever no components object is present at all —
 *  true for most `rank_final` and STAGE-6 rejected rows today, since only `scored`/
 *  `rank_governor`/governor-rejected rows carry the full breakdown (see this file's header). */
export function classifySetupTypeHeuristic(row: NighthawkCandidateSnapshotRow): SetupTypeKey {
  const components = row.snapshot_json?.components as Record<string, unknown> | undefined;
  if (!components) return "unknown";
  const scored = COMPONENT_LABELS.map(({ key, label }) => ({ label, value: components[key] })).filter(
    (c): c is { label: SetupTypeKey; value: number } => typeof c.value === "number" && Number.isFinite(c.value)
  );
  if (!scored.length) return "unknown";
  scored.sort((a, b) => b.value - a.value);
  const top = scored[0]!;
  const second = scored[1];
  if (second && top.value - second.value <= SETUP_TYPE_BALANCED_MARGIN) return "balanced";
  return top.label;
}

export const computeSetupTypeBucketStats = segmentStatsFor(SETUP_TYPE_ORDER, classifySetupTypeHeuristic);

// ─────────────────────────────────────────────────────────────────────────────
// Rejected-winner / Top-5-loser tracing
// ─────────────────────────────────────────────────────────────────────────────

export type Top5LoserRow = {
  edition_for: string;
  ticker: string;
  rank: number;
  direction: Direction;
  sign_aligned_eod_pct: number;
};

/** Published (rank_final) Top-5 rows whose sign-aligned EOD move was at or below the (negative)
 *  threshold — straightforward, since rank_final rows always carry a real rank. */
export function findTop5Losers(
  rows: readonly NighthawkCandidateSnapshotRow[],
  opts: { adverseThresholdPct?: number } = {}
): Top5LoserRow[] {
  const threshold = -(opts.adverseThresholdPct ?? DEFAULT_LARGE_MOVE_THRESHOLD_PCT);
  const results: Top5LoserRow[] = [];
  for (const row of rows) {
    if (row.stage !== "rank_final") continue;
    if (row.rank == null || row.rank > 5) continue;
    const direction = directionOf(row);
    if (!direction) continue;
    const eod = signAlignedReading(row).eod;
    if (eod == null || eod > threshold) continue;
    results.push({ edition_for: row.edition_for, ticker: row.ticker, rank: row.rank, direction, sign_aligned_eod_pct: eod });
  }
  return results.sort((a, b) => a.sign_aligned_eod_pct - b.sign_aligned_eod_pct);
}

export type RejectedWinnerRow = {
  edition_for: string;
  ticker: string;
  rejection_reason: string | null;
  rejection_detail: unknown;
  score: number | null;
  direction: Direction;
  sign_aligned_eod_pct: number;
  /** An honest, disclosed PROXY for "would this have made the book" — never the literal rank the
   *  candidate would have held, since that value was never recorded for governor/STAGE-6 rejects
   *  (see this file's header). Compares the row's own `score` against that same edition's real
   *  published scores when both exist; falls back to the STAGE-2 discovery rank (a genuinely
   *  different, pre-scoring position) when the row is a confluence-gate reject instead. */
  would_be_rank_estimate: string;
};

function publishedScoresByEdition(rows: readonly NighthawkCandidateSnapshotRow[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    if (row.stage !== "rank_final" || typeof row.score !== "number") continue;
    const arr = map.get(row.edition_for) ?? [];
    arr.push(row.score);
    map.set(row.edition_for, arr);
  }
  return map;
}

/** Rejected rows with a strongly favorable graded outcome — the counterfactual "did a gate throw
 *  away a real winner" the operator asked for. */
export function findRejectedWinners(
  rows: readonly NighthawkCandidateSnapshotRow[],
  opts: { favorableThresholdPct?: number } = {}
): RejectedWinnerRow[] {
  const threshold = opts.favorableThresholdPct ?? DEFAULT_LARGE_MOVE_THRESHOLD_PCT;
  const publishedScores = publishedScoresByEdition(rows);
  const results: RejectedWinnerRow[] = [];

  for (const row of rows) {
    if (row.stage !== "rejected") continue;
    const direction = directionOf(row);
    if (!direction) continue; // honestly excluded, never guessed
    const eod = signAlignedReading(row).eod;
    if (eod == null || eod < threshold) continue;

    let wouldBeRankEstimate = "no published plays that night to compare against";
    const publishedThatNight = (publishedScores.get(row.edition_for) ?? []).slice().sort((a, b) => b - a);
    if (typeof row.score === "number" && publishedThatNight.length) {
      const betterCount = publishedThatNight.filter((s) => s > row.score!).length;
      wouldBeRankEstimate = `score ${row.score} would have placed ~#${betterCount + 1} of that night's ${publishedThatNight.length} published play(s) by score`;
    } else if (row.rank != null) {
      wouldBeRankEstimate = `discovery-stage rank #${row.rank} (confluence-gate reject — a pre-scoring position, not a score-based estimate)`;
    }

    results.push({
      edition_for: row.edition_for,
      ticker: row.ticker,
      rejection_reason: row.rejection_reason,
      rejection_detail: (row.snapshot_json as { detail?: unknown } | null)?.detail ?? null,
      score: typeof row.score === "number" ? row.score : null,
      direction,
      sign_aligned_eod_pct: eod,
      would_be_rank_estimate: wouldBeRankEstimate,
    });
  }

  return results.sort((a, b) => b.sign_aligned_eod_pct - a.sign_aligned_eod_pct);
}
