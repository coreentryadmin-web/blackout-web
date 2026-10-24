/**
 * TRADE-ROW VERDICT AGGREGATION for the live-tick-log validation framework (operator directive
 * 2026-09-27, phase 3). Deliberately mirrors `banger-quote-tick-adversarial-validation.mjs`'s own
 * local `aggregateSimple`/`printAgg` helpers (same row shape: `{current, cand:{realizedPnlPct,
 * delta}}`, same math) rather than importing them — that script's own header explains why its local
 * copy doesn't reuse `aggregateHeadToHead` (a different row shape), and the same isolation reasoning
 * applies here: this module serves a DIFFERENT script (this framework reads `banger_quote_tick_log`
 * rows, not Polygon-reconstructed ones) and should not create a coupling between two independent
 * audit tools over a ~15-line aggregate. What IS reused, unmodified, is the substantial statistics
 * (`meanDeltaCi`, `equityCurveStats`, `deltaConcentration`, `leaveOutTopKVerdict`, `trimmedMeanDelta`
 * from `banger-exit-headtohead-eval.mjs`, `median` from `banger-regime-classify.mjs`) — only the
 * thin, row-shape-specific glue is duplicated, and only that.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */
import { equityCurveStats, meanDeltaCi } from "./banger-exit-headtohead-eval.mjs";
import { median } from "./banger-regime-classify.mjs";

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Aggregates a `tradeRows` array (`{current: number, [candKey]: {realizedPnlPct, delta}}`) into
 * win rate / expectancy / profit factor / equity-curve stats / mean-delta-with-CI, exactly the same
 * math the historical Polygon-reconstruction study reported, applied here to LIVE-tick-log-sourced
 * rows. `curKey` defaults to `"current"` (the control/production track); pass `"currentExec"` for
 * the executable-fill track, matching the historical script's own MODEL-vs-EXEC split.
 */
export function aggregateVerdict(rows, candKey, curKey = "current") {
  const usable = (rows ?? []).filter((r) => finite(r[curKey]) && r[candKey] && finite(r[candKey].realizedPnlPct));
  const n = usable.length;
  if (n === 0) return { n: 0, verdict: "NO DATA" };
  const candVals = usable.map((r) => r[candKey].realizedPnlPct);
  const curVals = usable.map((r) => r[curKey]);
  const wins = usable.filter((r) => r[candKey].realizedPnlPct > 0);
  const losses = usable.filter((r) => r[candKey].realizedPnlPct <= 0);
  const winRate = Math.round((wins.length / n) * 10000) / 100;
  const avgWinner = wins.length ? wins.reduce((a, r) => a + r[candKey].realizedPnlPct, 0) / wins.length : null;
  const avgLoser = losses.length ? losses.reduce((a, r) => a + r[candKey].realizedPnlPct, 0) / losses.length : null;
  const expectancy = Math.round((candVals.reduce((a, b) => a + b, 0) / n) * 100) / 100;
  const sumPos = wins.reduce((a, r) => a + r[candKey].realizedPnlPct, 0);
  const sumNegAbs = Math.abs(losses.reduce((a, r) => a + r[candKey].realizedPnlPct, 0));
  const profitFactor = sumNegAbs > 0 ? Math.round((sumPos / sumNegAbs) * 100) / 100 : sumPos > 0 ? Infinity : null;
  const curve = equityCurveStats(candVals);
  const deltas = usable.map((r) => r[candKey].delta).filter(finite);
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
