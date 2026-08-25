/**
 * G2 — thesis rank tier calibration from graded ledger rows.
 * Pure analyzer; does NOT auto-change commit gates until n≥30 per bucket.
 */
import type { CalibrationPlayRow } from "../calibration";
import { isGradedZeroDteRow, isZeroDteWin, LOW_N_THRESHOLD } from "../record";
import type { ThesisRankTier, TradeArchetype } from "./types";

export const THESIS_RANK_CALIBRATION_MIN_N = 30;
export const THESIS_RANK_CALIBRATION_MIN_DELTA_PTS = 10;

export type ThesisRankBucket = {
  label: string;
  n: number;
  wins: number;
  win_rate_pct: number | null;
  low_n: boolean;
};

export type ThesisRankRecommendation = {
  rank_tier: ThesisRankTier;
  verdict: "ready_to_tune" | "keep_calibrating" | "insufficient_data";
  n: number;
  win_rate_pct: number | null;
  baseline_win_rate_pct: number | null;
  delta_win_rate_pts: number | null;
  reason: string;
};

export type ThesisRankCalibrationReport = {
  methodology: string;
  graded_with_thesis: number;
  baseline_win_rate_pct: number | null;
  buckets: {
    rank_tier: ThesisRankBucket[];
    systems_aligned: ThesisRankBucket[];
    trade_archetype: ThesisRankBucket[];
    disagreeing_rails: ThesisRankBucket[];
  };
  recommendations: ThesisRankRecommendation[];
};

const round1 = (v: number): number => Math.round(v * 10) / 10;

type ThesisFirstCtx = {
  rank_tier?: ThesisRankTier;
  systems_aligned?: number;
  trade_archetype?: TradeArchetype;
  disagreeing_rails?: unknown[];
};

function readThesisFirst(row: CalibrationPlayRow): ThesisFirstCtx | null {
  const ec = row.entry_context as Record<string, unknown> | null | undefined;
  const tf = ec?.thesis_first;
  if (!tf || typeof tf !== "object") return null;
  return tf as ThesisFirstCtx;
}

function bucketRows(
  rows: CalibrationPlayRow[],
  labelFn: (tf: ThesisFirstCtx) => string
): ThesisRankBucket[] {
  const map = new Map<string, { n: number; wins: number }>();
  for (const r of rows) {
    const tf = readThesisFirst(r);
    if (!tf) continue;
    const label = labelFn(tf) || "?";
    const b = map.get(label) ?? { n: 0, wins: 0 };
    b.n += 1;
    if (isZeroDteWin(r)) b.wins += 1;
    map.set(label, b);
  }
  return [...map.entries()]
    .map(([label, { n, wins }]) => ({
      label,
      n,
      wins,
      win_rate_pct: n > 0 ? round1((wins / n) * 100) : null,
      low_n: n < LOW_N_THRESHOLD,
    }))
    .sort((a, b) => b.n - a.n);
}

function baselineWinRate(rows: CalibrationPlayRow[]): number | null {
  const graded = rows.filter(isGradedZeroDteRow);
  if (graded.length === 0) return null;
  const wins = graded.filter(isZeroDteWin).length;
  return round1((wins / graded.length) * 100);
}

function recommendRankTier(
  tier: ThesisRankTier,
  bucket: ThesisRankBucket | undefined,
  baseline: number | null
): ThesisRankRecommendation {
  if (!bucket || bucket.n === 0) {
    return {
      rank_tier: tier,
      verdict: "insufficient_data",
      n: 0,
      win_rate_pct: null,
      baseline_win_rate_pct: baseline,
      delta_win_rate_pts: null,
      reason: `No graded rows with thesis rank ${tier}.`,
    };
  }
  if (bucket.n < THESIS_RANK_CALIBRATION_MIN_N) {
    return {
      rank_tier: tier,
      verdict: "keep_calibrating",
      n: bucket.n,
      win_rate_pct: bucket.win_rate_pct,
      baseline_win_rate_pct: baseline,
      delta_win_rate_pts:
        baseline != null && bucket.win_rate_pct != null
          ? round1(bucket.win_rate_pct - baseline)
          : null,
      reason: `n=${bucket.n} < ${THESIS_RANK_CALIBRATION_MIN_N} — collect more thesis-first sessions before tuning gates.`,
    };
  }
  const delta =
    baseline != null && bucket.win_rate_pct != null
      ? bucket.win_rate_pct - baseline
      : null;
  const isTop = tier === "A+" || tier === "A";
  if (isTop && delta != null && delta >= THESIS_RANK_CALIBRATION_MIN_DELTA_PTS) {
    return {
      rank_tier: tier,
      verdict: "ready_to_tune",
      n: bucket.n,
      win_rate_pct: bucket.win_rate_pct,
      baseline_win_rate_pct: baseline,
      delta_win_rate_pts: delta,
      reason: `${tier} WR ${bucket.win_rate_pct}% beats baseline ${baseline}% by ${delta}pp (n=${bucket.n}).`,
    };
  }
  if (isTop && delta != null && delta < THESIS_RANK_CALIBRATION_MIN_DELTA_PTS) {
    return {
      rank_tier: tier,
      verdict: "keep_calibrating",
      n: bucket.n,
      win_rate_pct: bucket.win_rate_pct,
      baseline_win_rate_pct: baseline,
      delta_win_rate_pts: delta,
      reason: `${tier} does not clear +${THESIS_RANK_CALIBRATION_MIN_DELTA_PTS}pp vs baseline — keep rank cap, do not promote to commit gate.`,
    };
  }
  return {
    rank_tier: tier,
    verdict: "keep_calibrating",
    n: bucket.n,
    win_rate_pct: bucket.win_rate_pct,
    baseline_win_rate_pct: baseline,
    delta_win_rate_pts: delta,
    reason: `Observed ${tier} bucket (n=${bucket.n}); only A/A+ tiers graduate to gate tuning.`,
  };
}

/** Analyze graded ledger rows carrying entry_context.thesis_first. */
export function analyzeThesisRankCalibration(rows: CalibrationPlayRow[]): ThesisRankCalibrationReport {
  const withThesis = rows.filter((r) => readThesisFirst(r) != null && isGradedZeroDteRow(r));
  const baseline = baselineWinRate(withThesis);

  const rankBuckets = bucketRows(withThesis, (tf) => String(tf.rank_tier ?? "?"));
  const byTier = new Map(rankBuckets.map((b) => [b.label, b]));

  const recommendations: ThesisRankRecommendation[] = (["A+", "A", "B"] as ThesisRankTier[]).map(
    (tier) => recommendRankTier(tier, byTier.get(tier), baseline)
  );

  return {
    methodology:
      "Thesis rank calibration over GRADED plays with entry_context.thesis_first. " +
      `A/A+ tiers need n≥${THESIS_RANK_CALIBRATION_MIN_N} AND ≥${THESIS_RANK_CALIBRATION_MIN_DELTA_PTS}pp vs baseline before rank rules become commit gates.`,
    graded_with_thesis: withThesis.length,
    baseline_win_rate_pct: baseline,
    buckets: {
      rank_tier: rankBuckets,
      systems_aligned: bucketRows(withThesis, (tf) => String(tf.systems_aligned ?? "?")),
      trade_archetype: bucketRows(withThesis, (tf) => String(tf.trade_archetype ?? "?")),
      disagreeing_rails: bucketRows(withThesis, (tf) =>
        (tf.disagreeing_rails?.length ?? 0) > 0 ? "yes" : "no"
      ),
    },
    recommendations,
  };
}
