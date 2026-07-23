/**
 * META-ENGINE HEALTH — grade the ENGINE, not just the trades (design-review #11, with #8 drift folded in).
 *
 * Per-trade grading tells you if a trade worked. It does NOT tell you whether the ENGINE is improving or
 * quietly decaying. This computes the engine-level diagnostics the review asked for, over the graded
 * feature-store rows (feature-store.ts): win rate by regime / hour / score bucket, the winner-vs-loser score
 * separation (is the score actually predictive?), score-bucket MONOTONICITY (do higher buckets really win
 * more — the calibration/drift sanity check), and realized P&L stats.
 *
 * DRIFT (#8) is the monotonicity + separation read: when the score stops separating winners from losers, or
 * higher buckets stop winning more, the engine's core signal is losing predictive power — that's drift, and
 * it's visible here before the equity curve rolls over.
 *
 * CALIBRATION-FIRST: every rate is sample-guarded (null below MIN_SAMPLES) so a thin cut can't masquerade as
 * a verdict on the engine. PURE & deterministic — reads the store, computes; the DB read lives elsewhere.
 */

import {
  scoreBand,
  MIN_SAMPLES,
  type GradedFeatureRow,
  type BaseRate,
} from "../zerodte/feature-store";

/** ET-minute → session bucket (the review's "win rate by hour"). tod_min is minutes since the 9:30 open. */
export function sessionBucket(todMin: number | null | undefined): string {
  if (todMin == null || !Number.isFinite(todMin)) return "unknown";
  if (todMin < 45) return "open (9:30–10:15)";
  if (todMin < 90) return "morning (10:15–11:00)";
  if (todMin < 300) return "midday (11:00–14:30)";
  if (todMin < 360) return "power (14:30–15:30)";
  return "close (15:30–16:00)";
}

function emptyRate(): BaseRate {
  return { n: 0, wins: 0, winRate: null, pnlSum: 0, pnlN: 0 };
}
function add(cell: BaseRate, row: GradedFeatureRow): void {
  cell.n += 1;
  if (row.label === "win") cell.wins += 1;
  if (row.pnlPct != null) {
    cell.pnlSum += row.pnlPct;
    cell.pnlN += 1;
  }
}
function seal(cell: BaseRate): BaseRate {
  cell.winRate = cell.n >= MIN_SAMPLES ? cell.wins / cell.n : null;
  return cell;
}
const num = (r: GradedFeatureRow, k: string): number | null => {
  const v = (r.features as unknown as Record<string, unknown>)[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export interface EngineHealth {
  overall: BaseRate;
  byRegime: Record<string, BaseRate>;
  byHour: Record<string, BaseRate>;
  byScoreBucket: Record<string, BaseRate>;
  /** Mean evidence score of winners vs losers — the score is predictive only if winners score higher. */
  scoreSeparation: { winnerMean: number | null; loserMean: number | null; edge: number | null };
  /** Do higher score buckets win more? true = monotone (healthy); false = inverted/flat (drift signal). */
  scoreMonotone: boolean | null;
  /** Mean realized plan P&L % across rows that recorded one. */
  avgPnlPct: number | null;
  /** How many graded rows this health read is built on (context for every rate above). */
  sample: number;
}

function bump(map: Record<string, BaseRate>, key: string, row: GradedFeatureRow): void {
  (map[key] ??= emptyRate());
  add(map[key]!, row);
}

/** Compute the engine-level health diagnostics over graded feature rows. */
export function computeEngineHealth(rows: GradedFeatureRow[]): EngineHealth {
  const overall = emptyRate();
  const byRegime: Record<string, BaseRate> = {};
  const byHour: Record<string, BaseRate> = {};
  const byScoreBucket: Record<string, BaseRate> = {};
  const winnerScores: number[] = [];
  const loserScores: number[] = [];

  for (const row of rows) {
    add(overall, row);
    const reg = typeof row.features.reg_structure === "string" ? row.features.reg_structure : "unknown";
    bump(byRegime, reg, row);
    bump(byHour, sessionBucket(num(row, "tod_min")), row);
    bump(byScoreBucket, scoreBand(num(row, "evidence_score")), row);
    const es = num(row, "evidence_score");
    if (es != null) (row.label === "win" ? winnerScores : loserScores).push(es);
  }

  seal(overall);
  for (const m of [byRegime, byHour, byScoreBucket]) for (const k of Object.keys(m)) seal(m[k]!);

  const mean = (a: number[]): number | null => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null);
  const winnerMean = mean(winnerScores);
  const loserMean = mean(loserScores);
  const edge = winnerMean != null && loserMean != null ? Math.round((winnerMean - loserMean) * 10) / 10 : null;

  // Monotonicity: over the buckets that cleared the sample floor (so noise can't fake a break), each higher
  // score band should have a win rate >= the one below it. A violation is a drift/calibration red flag.
  const ORDER = ["<65", "65-74", "75-84", "85+"];
  const resolved = ORDER.map((b) => byScoreBucket[b]?.winRate).filter((w): w is number => w != null);
  let scoreMonotone: boolean | null = null;
  if (resolved.length >= 2) {
    scoreMonotone = true;
    for (let i = 1; i < resolved.length; i++) if (resolved[i]! < resolved[i - 1]! - 1e-9) scoreMonotone = false;
  }

  const avgPnlPct = overall.pnlN > 0 ? Math.round((overall.pnlSum / overall.pnlN) * 100) / 100 : null;

  return {
    overall,
    byRegime,
    byHour,
    byScoreBucket,
    scoreSeparation: { winnerMean, loserMean, edge },
    scoreMonotone,
    avgPnlPct,
    sample: overall.n,
  };
}
