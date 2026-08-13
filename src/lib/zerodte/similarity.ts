/**
 * 0DTE SETUP SIMILARITY — k-NN over pinned feature vectors with honest outcome distribution.
 *
 * Reads the graded feature store (feature-store.ts + db fetchGradedFeatureVectorRows) and
 * returns nearest analogs plus a FULL distribution — not a single win-rate headline.
 * Distance standardizes numerics from the corpus empirical mean/std; categoricals add a
 * mismatch penalty when both sides carry a value.
 */

import type { SetupFeatureVector } from "./feature-vector";
import {
  CATEGORICAL_FEATURE_KEYS,
  NUMERIC_FEATURE_KEYS,
  numericVector,
} from "./feature-vector";
import {
  toGradedFeatureRows,
  type GradedFeatureRow,
  type RawGradedRow,
} from "./feature-store";
import { wilsonInterval, type ProportionInterval } from "./calibration-stats";

export const DEFAULT_SIMILARITY_K = 27;
export const MIN_NEIGHBORS_FOR_DISTRIBUTION = 5;

export type SimilarityNeighbor = {
  ticker: string;
  sessionDate: string;
  distance: number;
  label: "win" | "loss";
  pnlPct: number | null;
  planOutcome: string | null;
};

export type OutcomeDistribution = {
  /** Counts by official plan_outcome bucket. */
  byOutcome: {
    doubled: number;
    stopped: number;
    time_stop: number;
    other: number;
  };
  wins: number;
  losses: number;
  /** P&L histogram over neighbors with recorded pnlPct. */
  pnlBuckets: {
    big_win: number;
    moderate_win: number;
    moderate_loss: number;
    stopped_out: number;
  };
  avgPnlPct: number | null;
  medianPnlPct: number | null;
  /** Wilson 95% interval on win proportion — null when n < MIN_NEIGHBORS_FOR_DISTRIBUTION. */
  winRateWilson: ProportionInterval | null;
};

export type SimilarityResult = {
  k: number;
  corpusSize: number;
  neighbors: SimilarityNeighbor[];
  distribution: OutcomeDistribution;
  insufficientNeighbors: boolean;
};

type NumericStandardizer = {
  mean: number[];
  std: number[];
};

function buildStandardizer(rows: GradedFeatureRow[]): NumericStandardizer {
  const cols = NUMERIC_FEATURE_KEYS.length;
  const sums = Array(cols).fill(0);
  const sumSq = Array(cols).fill(0);
  const counts = Array(cols).fill(0);

  for (const row of rows) {
    const vec = numericVector(row.features);
    for (let i = 0; i < cols; i++) {
      const v = vec[i];
      if (v == null) continue;
      sums[i] += v;
      sumSq[i] += v * v;
      counts[i] += 1;
    }
  }

  const mean = sums.map((s, i) => (counts[i] > 0 ? s / counts[i]! : 0));
  const std = mean.map((m, i) => {
    const n = counts[i]!;
    if (n < 2) return 1;
    const variance = Math.max(0, sumSq[i]! / n - m * m);
    return Math.sqrt(variance) || 1;
  });

  return { mean, std };
}

function categoricalPenalty(a: SetupFeatureVector, b: SetupFeatureVector): number {
  let penalty = 0;
  for (const key of CATEGORICAL_FEATURE_KEYS) {
    const va = a[key];
    const vb = b[key];
    if (va == null || vb == null) continue;
    if (String(va) !== String(vb)) penalty += 0.35;
  }
  return penalty;
}

function distanceBetween(
  query: SetupFeatureVector,
  candidate: SetupFeatureVector,
  standardizer: NumericStandardizer
): number {
  const qNum = numericVector(query);
  const cNum = numericVector(candidate);
  let sumSq = 0;
  let used = 0;
  for (let i = 0; i < qNum.length; i++) {
    const qv = qNum[i];
    const cv = cNum[i];
    if (qv == null || cv == null) continue;
    const zq = (qv - standardizer.mean[i]!) / standardizer.std[i]!;
    const zc = (cv - standardizer.mean[i]!) / standardizer.std[i]!;
    sumSq += (zq - zc) ** 2;
    used += 1;
  }
  const numericDist = used > 0 ? Math.sqrt(sumSq / used) : 10;
  return numericDist + categoricalPenalty(query, candidate);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pnlBucket(pnl: number): keyof OutcomeDistribution["pnlBuckets"] {
  if (pnl > 50) return "big_win";
  if (pnl > 0) return "moderate_win";
  if (pnl > -50) return "moderate_loss";
  return "stopped_out";
}

export function buildOutcomeDistribution(
  neighbors: SimilarityNeighbor[]
): OutcomeDistribution {
  const byOutcome = { doubled: 0, stopped: 0, time_stop: 0, other: 0 };
  let wins = 0;
  let losses = 0;
  const pnlBuckets = { big_win: 0, moderate_win: 0, moderate_loss: 0, stopped_out: 0 };
  const pnls: number[] = [];
  let pnlSum = 0;

  for (const n of neighbors) {
    if (n.label === "win") wins += 1;
    else losses += 1;
    const outcome = (n.planOutcome ?? "").toLowerCase();
    if (outcome === "doubled") byOutcome.doubled += 1;
    else if (outcome === "stopped") byOutcome.stopped += 1;
    else if (outcome === "time_stop") byOutcome.time_stop += 1;
    else byOutcome.other += 1;

    if (n.pnlPct != null && Number.isFinite(n.pnlPct)) {
      pnls.push(n.pnlPct);
      pnlSum += n.pnlPct;
      pnlBuckets[pnlBucket(n.pnlPct)] += 1;
    }
  }

  const n = neighbors.length;
  const winRateWilson =
    n >= MIN_NEIGHBORS_FOR_DISTRIBUTION ? wilsonInterval(wins, n) : null;

  return {
    byOutcome,
    wins,
    losses,
    pnlBuckets,
    avgPnlPct: pnls.length ? pnlSum / pnls.length : null,
    medianPnlPct: median(pnls),
    winRateWilson,
  };
}

export type FindSimilarOptions = {
  k?: number;
  /** Restrict neighbors to this ticker root (recommended for "like today's NVDA"). */
  sameTicker?: boolean;
  /** Exclude this session from neighbors (don't match self). */
  excludeSessionDate?: string | null;
};

/**
 * Find k nearest graded setups to `query` and summarize their outcomes.
 * Pure given corpus rows — IO happens in the Largo wrapper.
 */
export function findSimilarZeroDteSetups(
  query: SetupFeatureVector,
  rawRows: RawGradedRow[],
  opts: FindSimilarOptions = {}
): SimilarityResult {
  const k = opts.k ?? DEFAULT_SIMILARITY_K;
  const corpus = toGradedFeatureRows(rawRows);
  const standardizer = buildStandardizer(corpus);
  const queryTicker = query.ticker.toUpperCase();
  const excludeDate = opts.excludeSessionDate ?? null;

  const scored: Array<{ row: GradedFeatureRow; distance: number; planOutcome: string | null }> = [];
  for (const raw of rawRows) {
    const rowTicker = String(raw.ticker ?? "").toUpperCase();
    const sessionDate = typeof raw.session_date === "string" ? raw.session_date : "";
    if (opts.sameTicker !== false && rowTicker !== queryTicker) continue;
    if (excludeDate && sessionDate === excludeDate && rowTicker === queryTicker) continue;

    const graded = toGradedFeatureRows([raw]);
    const row = graded[0];
    if (!row) continue;

    scored.push({
      row,
      distance: distanceBetween(query, row.features, standardizer),
      planOutcome: typeof raw.plan_outcome === "string" ? raw.plan_outcome : null,
    });
  }

  scored.sort((a, b) => a.distance - b.distance);
  const top = scored.slice(0, k);

  const neighbors: SimilarityNeighbor[] = top.map(({ row, distance, planOutcome }) => ({
    ticker: row.ticker,
    sessionDate: row.sessionDate,
    distance: Math.round(distance * 1000) / 1000,
    label: row.label,
    pnlPct: row.pnlPct,
    planOutcome,
  }));

  return {
    k,
    corpusSize: corpus.length,
    neighbors,
    distribution: buildOutcomeDistribution(neighbors),
    insufficientNeighbors: neighbors.length < MIN_NEIGHBORS_FOR_DISTRIBUTION,
  };
}
