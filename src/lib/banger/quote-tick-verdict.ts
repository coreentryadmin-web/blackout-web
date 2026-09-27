/**
 * BANGER LIVE-TICK-LOG REPLAY + VERDICT AGGREGATION — production TypeScript port of
 * `scripts/audit/lib/banger-quote-tick-replay-eval.mjs` + `banger-tick-verdict-agg.mjs` (operator
 * directive 2026-09-27, phase 4). See `quote-tick-readiness.ts`'s header for why this is a port
 * rather than a shared import (same reasoning: the `.mjs` originals are CLI-tool-shaped; this is a
 * clean, typed module for the admin status route).
 *
 * `replayTickState`/`replayPairTick` are BYTE-IDENTICAL in logic to the oracle-tested `.mjs`
 * original (proven exact against the REAL `deriveScaleOutAction` in that module's own test file) —
 * ported here verbatim, self-contained, no external imports needed (the live-tick-log path never
 * needs `buildReliableMarkSeries`, since `banger_quote_tick_log` rows already carry a pre-resolved
 * `reliable_mark` computed by the SAME production `reliableMarkFromQuote` at write time).
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */
import type { ReplayTick } from "@/lib/banger/quote-tick-readiness";

function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
const round2 = (x: number | null): number | null => (x == null ? null : Math.round(x * 100) / 100);

export type ScaleOutRules = { scale_at_mult: number; scale_fraction: number; trail_from_peak: number; hard_stop_mult: number };

/** Production's real, current rule (`src/lib/zerodte/scale-out.ts`'s `SCALE_OUT_RULES`). */
export const CONTROL_RULES: ScaleOutRules = { scale_at_mult: 2.0, scale_fraction: 0.5, trail_from_peak: 0.5, hard_stop_mult: 0.4 };
/** The 100/33/70 candidate studied in #5521/#5522 -- UNCHANGED here. This module never tunes it. */
export const CANDIDATE_RULES: ScaleOutRules = { scale_at_mult: 2.0, scale_fraction: 0.33, trail_from_peak: 0.7, hard_stop_mult: 0.4 };

export type ReplayResult = {
  modelRealizedMultiple: number;
  execRealizedMultiple: number;
  exitCause: string;
  scaled: boolean;
  peakAtExit: number;
  exitTickIndex: number | null;
  exitTickT: number | null;
};

export function replayTickState(ticks: ReplayTick[], entryPremium: number, rules: ScaleOutRules): ReplayResult {
  const { scale_at_mult, scale_fraction, trail_from_peak, hard_stop_mult } = rules;
  if (!(entryPremium > 0) || ticks.length === 0) {
    return { modelRealizedMultiple: 1, execRealizedMultiple: 1, exitCause: "no_data", scaled: false, peakAtExit: entryPremium, exitTickIndex: null, exitTickT: null };
  }
  let peak = entryPremium;
  let scaled = false;
  let modelRealized = 0;
  let execRealized = 0;
  let remaining = 1;

  const finalize = (meta: Omit<ReplayResult, "modelRealizedMultiple" | "execRealizedMultiple">): ReplayResult => ({
    modelRealizedMultiple: modelRealized / entryPremium,
    execRealizedMultiple: execRealized / entryPremium,
    ...meta,
  });

  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i]!;
    const mark = tick.mark;
    if (!finite(mark) || mark < 0) continue;
    const bid = finite(tick.bid) ? tick.bid : mark;
    const newPeak = Math.max(peak, mark);

    if (!scaled) {
      if (mark <= entryPremium * hard_stop_mult) {
        const modelFill = entryPremium * hard_stop_mult;
        const execFill = Math.min(bid, modelFill);
        modelRealized += remaining * modelFill;
        execRealized += remaining * execFill;
        remaining = 0;
        return finalize({ exitCause: "hard_stop", scaled: false, peakAtExit: newPeak, exitTickIndex: i, exitTickT: tick.t });
      }
      if (mark >= entryPremium * scale_at_mult) {
        const modelFill = entryPremium * scale_at_mult;
        const execFill = Math.min(bid, modelFill);
        modelRealized += scale_fraction * modelFill;
        execRealized += scale_fraction * execFill;
        remaining -= scale_fraction;
        scaled = true;
      }
    } else if (mark <= peak * trail_from_peak) {
      const modelFill = mark; // production's REAL formula: the tick's ACTUAL mark, not the theoretical trail level
      const execFill = Math.min(bid, modelFill);
      modelRealized += remaining * modelFill;
      execRealized += remaining * execFill;
      remaining = 0;
      return finalize({ exitCause: "trail_stop", scaled: true, peakAtExit: newPeak, exitTickIndex: i, exitTickT: tick.t });
    }
    peak = newPeak;
  }

  if (remaining > 0) {
    const last = ticks.at(-1)!;
    const lastMark = finite(last.mark) ? last.mark : entryPremium;
    const lastBid = finite(last.bid) ? last.bid : lastMark;
    modelRealized += remaining * lastMark;
    execRealized += remaining * Math.min(lastBid, lastMark);
  }
  return finalize({
    exitCause: scaled ? "series_end_after_scale" : "series_end_never_triggered",
    scaled,
    peakAtExit: peak,
    exitTickIndex: ticks.length - 1,
    exitTickT: ticks.at(-1)?.t ?? null,
  });
}

export type ReplayPairResult = {
  control: ReplayResult & { modelPct: number | null; execPct: number | null };
  candidate: ReplayResult & { modelPct: number | null; execPct: number | null };
  modelDelta: number | null;
  execDelta: number | null;
};

export function replayPairTick(ticks: ReplayTick[], entryPremium: number, controlRules: ScaleOutRules, candidateRules: ScaleOutRules): ReplayPairResult {
  const control = replayTickState(ticks, entryPremium, controlRules);
  const candidate = replayTickState(ticks, entryPremium, candidateRules);
  const controlModelPct = round2((control.modelRealizedMultiple - 1) * 100);
  const candidateModelPct = round2((candidate.modelRealizedMultiple - 1) * 100);
  const controlExecPct = round2((control.execRealizedMultiple - 1) * 100);
  const candidateExecPct = round2((candidate.execRealizedMultiple - 1) * 100);
  return {
    control: { ...control, modelPct: controlModelPct, execPct: controlExecPct },
    candidate: { ...candidate, modelPct: candidateModelPct, execPct: candidateExecPct },
    modelDelta: finite(controlModelPct) && finite(candidateModelPct) ? round2(candidateModelPct - controlModelPct) : null,
    execDelta: finite(controlExecPct) && finite(candidateExecPct) ? round2(candidateExecPct - controlExecPct) : null,
  };
}

// ─── Partial-fill safeguard: replayed `scaled` flag vs the real recorded DB state ──────────────────

export type ScaledFlagCrossCheck = {
  matches: boolean;
  replayScaled: boolean;
  recordedScaledAlready: boolean;
  reason: string | null;
};

/**
 * "Partial fills" safeguard (operator directive point 5). Even a FULL-coverage tick series can
 * still miss a real partial fill if a scale-out happened BETWEEN two polls at a price the log never
 * captured -- the replayed CONTROL state machine would then reach a different `scaled` boolean than
 * what `banger_positions.scaled_already` actually recorded for that trade. A silent disagreement
 * here means the reconstructed trade is not the same trade that actually happened, so it must not
 * be trusted for the CONTROL-vs-CANDIDATE study even though its tick coverage otherwise looks
 * clean. Compare against the CONTROL replay specifically (the CANDIDATE never ran in production, so
 * it has no recorded flag to agree or disagree with).
 */
export function crossCheckScaledFlag(replayControlScaled: boolean, recordedScaledAlready: boolean): ScaledFlagCrossCheck {
  const matches = replayControlScaled === recordedScaledAlready;
  return {
    matches,
    replayScaled: replayControlScaled,
    recordedScaledAlready,
    reason: matches ? null : `control_replay_scaled_${replayControlScaled}_vs_recorded_scaled_already_${recordedScaledAlready}`,
  };
}

// ─── Verdict aggregation (ported from banger-exit-headtohead-eval.mjs + banger-tick-verdict-agg.mjs) ──

export function median(values: number[]): number | null {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[m - 1]! + v[m]!) / 2 : v[m]!;
}

export type EquityCurveStats = { totalReturnPts: number; maxDrawdownPts: number };

export function equityCurveStats(chronologicalReturnsPct: number[]): EquityCurveStats {
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  for (const r of chronologicalReturnsPct) {
    if (!finite(r)) continue;
    cum += r;
    if (cum > peak) peak = cum;
    const dd = cum - peak;
    if (dd < maxDD) maxDD = dd;
  }
  return { totalReturnPts: Math.round(cum * 100) / 100, maxDrawdownPts: Math.round(maxDD * 100) / 100 };
}

export type MeanDeltaCi = { n: number; meanDelta: number | null; ci: { lo: number; hi: number } | null; verdict: string };

export function meanDeltaCi(deltas: number[]): MeanDeltaCi {
  const n = deltas.length;
  if (n < 2) return { n, meanDelta: n === 1 ? round2(deltas[0]!) : null, ci: null, verdict: "INSUFFICIENT N" };
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / n;
  const variance = deltas.reduce((a, d) => a + (d - meanDelta) ** 2, 0) / (n - 1);
  const stderr = Math.sqrt(variance / n);
  const ci = { lo: round2(meanDelta - 1.96 * stderr)!, hi: round2(meanDelta + 1.96 * stderr)! };
  const verdict = ci.lo > 0 ? "CANDIDATE SEPARATED (better)" : ci.hi < 0 ? "CURRENT SEPARATED (better)" : "INCONCLUSIVE";
  return { n, meanDelta: round2(meanDelta), ci, verdict };
}

export type TradeRow = {
  id: number;
  ticker: string;
  current: number;
  cand: { realizedPnlPct: number; delta: number | null };
};

export type VerdictAgg = {
  n: number;
  verdict: string;
  winRate?: number;
  avgWinner?: number | null;
  avgLoser?: number | null;
  expectancy?: number;
  profitFactor?: number | null;
  maxDrawdownPts?: number;
  totalReturnPts?: number;
  medianCurrent?: number | null;
  medianCandidate?: number | null;
  meanDelta?: number | null;
  ci?: { lo: number; hi: number } | null;
};

export function aggregateVerdict(rows: TradeRow[]): VerdictAgg {
  const usable = rows.filter((r) => finite(r.current) && r.cand && finite(r.cand.realizedPnlPct));
  const n = usable.length;
  if (n === 0) return { n: 0, verdict: "NO DATA" };
  const candVals = usable.map((r) => r.cand.realizedPnlPct);
  const curVals = usable.map((r) => r.current);
  const wins = usable.filter((r) => r.cand.realizedPnlPct > 0);
  const losses = usable.filter((r) => r.cand.realizedPnlPct <= 0);
  const winRate = Math.round((wins.length / n) * 10000) / 100;
  const avgWinner = wins.length ? wins.reduce((a, r) => a + r.cand.realizedPnlPct, 0) / wins.length : null;
  const avgLoser = losses.length ? losses.reduce((a, r) => a + r.cand.realizedPnlPct, 0) / losses.length : null;
  const expectancy = Math.round((candVals.reduce((a, b) => a + b, 0) / n) * 100) / 100;
  const sumPos = wins.reduce((a, r) => a + r.cand.realizedPnlPct, 0);
  const sumNegAbs = Math.abs(losses.reduce((a, r) => a + r.cand.realizedPnlPct, 0));
  const profitFactor = sumNegAbs > 0 ? Math.round((sumPos / sumNegAbs) * 100) / 100 : sumPos > 0 ? Infinity : null;
  const curve = equityCurveStats(candVals);
  const deltas = usable.map((r) => r.cand.delta).filter(finite);
  const { meanDelta, ci, verdict } = meanDeltaCi(deltas);
  return {
    n,
    winRate,
    avgWinner,
    avgLoser,
    expectancy,
    profitFactor,
    maxDrawdownPts: curve.maxDrawdownPts,
    totalReturnPts: curve.totalReturnPts,
    medianCurrent: median(curVals),
    medianCandidate: median(candVals),
    meanDelta,
    ci,
    verdict,
  };
}
