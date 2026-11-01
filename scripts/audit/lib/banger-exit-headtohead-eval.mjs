/**
 * BANGER EXIT CANDIDATE HEAD-TO-HEAD (operator directive 2026-09-27, follow-up to the exit-
 * optimization grid). Compares the +100%/50% and +200%/67% candidates against Banger's REAL
 * production exit behavior — trade by trade, not just aggregates — and adds the overfitting/outlier
 * checks the operator asked for (a mean-delta CI alone can hide a result driven by a handful of
 * trades).
 *
 * CRITICAL MODELING CORRECTION found WHILE BUILDING THIS (a test caught it — see this module's own
 * test file, "candidateEqualsCurrent: proves the +100%/50% identity" originally failed): Banger's
 * REAL production rule (`src/lib/zerodte/scale-out.ts`'s `SCALE_OUT_RULES`) is ALREADY "50% off at
 * 2x entry (+100%), hard stop at -60% pre-partial, runner trails 50% off its own peak." For the
 * ~43% of closed rows where that partial actually fired (`scaled_already: true`), the exported
 * `realized_pnl_pct` is ITSELF already a blend: `0.5*100 + 0.5*rawRunnerReturnPct` (verified exactly
 * against a real row: DBX id=49, entry 0.5, realized_pnl_pct 55, and 2*55-100=10 implies an exit mark
 * of 0.55 — which IS the row's own `last_mark`, confirming the formula). Feeding that already-blended
 * number straight into `evaluateSummaryTierGridCell` as "the raw current return" — the naive approach
 * this module's first draft took — DOUBLE-BLENDS it: a candidate nominally set to production's own
 * exact trigger/fraction (100%/50%) would NOT reproduce `realized_pnl_pct`, purely as an artifact of
 * re-blending an already-blended input, not because the candidate is actually different.
 *
 * FIX: for any row with `scaled_already: true`, invert production's OWN fixed, known blend to recover
 * the raw single-leg return the position would have shown had it ridden UNSCALED to its real final
 * exit mark: `rawFullReturnPct = 2*realized_pnl_pct - 100` (inverting `blended = 0.5*100 +
 * 0.5*raw`). For `scaled_already: false` rows (every STOP_OUT, and the rare pre-scale EXPIRED), the
 * recorded `realized_pnl_pct` already IS a raw single-leg return (no blending ever occurred), so it
 * is used as-is. `syntheticFullReturnPct()` is this reconstruction, applied uniformly BEFORE any
 * candidate is evaluated — `current` (the real recorded outcome members actually got) is NEVER
 * altered; only the intermediate input fed to `evaluateSummaryTierGridCell` is corrected. This makes
 * Candidate A (100%/50%, production's own real rule) reproduce `current` exactly — proven empirically
 * by `candidateEqualsCurrent`, not asserted — and makes Candidate B's delta a genuine measurement
 * against the same corrected baseline rather than an artifact of double-blending.
 *
 * Candidate B (triggerPct=200, fraction=0.67) is the real, distinguishable alternative — later,
 * bigger partial — and is where the actual "what do we gain / what do we sacrifice" analysis lives.
 *
 * PURE AND TOTAL: no IO, no clock, no throw. Reuses `evaluateSummaryTierGridCell` from
 * swing-exit-optimization-eval.mjs UNMODIFIED — never reimplements the blend math.
 */
import { evaluateSummaryTierGridCell } from "./swing-exit-optimization-eval.mjs";

function finiteNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/** Recovers the raw, single-leg "as if ridden unscaled to the real final exit mark" return —
 *  see this module's header for the derivation and the real-data proof (DBX id=49). */
export function syntheticFullReturnPct(row) {
  const realized = finiteNum(row?.realized_pnl_pct) ? row.realized_pnl_pct : null;
  if (realized == null) return null;
  if (row?.scaled_already === true) return Math.round((2 * realized - 100) * 100) / 100;
  return realized;
}

const finite = finiteNum;
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/** One row's full comparison across every named candidate config, plus the current-behavior context
 *  needed for trade-level review (giveback, DTE, exit reason). `candidates` is {key: cfg}.
 *  Candidates are evaluated against the RECONSTRUCTED single-leg return (`syntheticFullReturnPct`),
 *  never against the raw (possibly already-blended) `realized_pnl_pct` — see this module's header. */
export function buildTradeRow(row, candidates) {
  const entry = finite(row.entry_premium) ? row.entry_premium : null;
  const peak = finite(row.peak_premium) ? row.peak_premium : null;
  const current = finite(row.realized_pnl_pct) ? row.realized_pnl_pct : null;
  const syntheticRow = { ...row, realized_pnl_pct: syntheticFullReturnPct(row) };
  const peakPct = entry > 0 && peak != null ? round2((peak / entry - 1) * 100) : null;
  const dte =
    row.session_date && row.contract_expiry
      ? Math.round((Date.parse(`${row.contract_expiry}T00:00:00Z`) - Date.parse(`${row.session_date}T00:00:00Z`)) / 86_400_000)
      : null;

  const out = {
    id: row.id,
    ticker: row.ticker,
    sessionDate: row.session_date,
    contractExpiry: row.contract_expiry,
    contractStrike: row.contract_strike,
    dte,
    entryPremium: entry,
    peakPremium: peak,
    troughPremium: finite(row.trough_premium) ? row.trough_premium : null,
    scaleOutAction: row.scale_out_action,
    status: row.status,
    committedAt: row.committed_at,
    closedAt: row.closed_at,
    current,
    peakPct,
    givebackPtsCurrent: peakPct != null && current != null ? round2(peakPct - current) : null,
  };
  for (const [key, cfg] of Object.entries(candidates)) {
    const c = evaluateSummaryTierGridCell(syntheticRow, cfg);
    out[key] = c
      ? {
          realizedPnlPct: c.realizedPnlPct,
          triggered: c.triggered,
          mfeCapturedPct: c.mfeCapturedPct,
          delta: current != null && c.realizedPnlPct != null ? round2(c.realizedPnlPct - current) : null,
          givebackPts: peakPct != null && c.realizedPnlPct != null ? round2(peakPct - c.realizedPnlPct) : null,
        }
      : null;
  }
  return out;
}

/** Empirical proof (not assertion) that a candidate config reproduces current behavior byte-for-
 *  byte — used to confirm the +100%/50% == current identity described in this module's header
 *  before the report treats it as a real finding rather than a guess. */
export function candidateEqualsCurrent(tradeRows, candidateKey, tolerance = 0.01) {
  const usable = tradeRows.filter((r) => finite(r.current) && r[candidateKey] && finite(r[candidateKey].realizedPnlPct));
  const mismatches = usable.filter((r) => Math.abs(r[candidateKey].delta) > tolerance);
  return {
    n: usable.length,
    mismatchN: mismatches.length,
    identical: mismatches.length === 0,
    sampleMismatches: mismatches.slice(0, 5).map((r) => ({ id: r.id, ticker: r.ticker, current: r.current, candidate: r[candidateKey].realizedPnlPct })),
  };
}

/** Chronological equity-curve stats for a candidate: cumulative sum of per-trade % returns (equal-
 *  weighted, 1 unit notional per trade — the same simplification the study's "total return" figures
 *  use elsewhere; disclosed, not silent) and the curve's own max peak-to-trough drawdown in points. */
export function equityCurveStats(chronologicalReturnsPct) {
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
  return { totalReturnPts: round2(cum), maxDrawdownPts: round2(maxDD) };
}

function meanDeltaCi(deltas) {
  const n = deltas.length;
  if (n < 2) return { n, meanDelta: n === 1 ? round2(deltas[0]) : null, ci: null, verdict: "INSUFFICIENT N" };
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / n;
  const variance = deltas.reduce((a, d) => a + (d - meanDelta) ** 2, 0) / (n - 1);
  const stderr = Math.sqrt(variance / n);
  const ci = { lo: round2(meanDelta - 1.96 * stderr), hi: round2(meanDelta + 1.96 * stderr) };
  const verdict = ci.lo > 0 ? "CANDIDATE SEPARATED (better)" : ci.hi < 0 ? "CURRENT SEPARATED (better)" : "INCONCLUSIVE";
  return { n, meanDelta: round2(meanDelta), ci, verdict };
}
export { meanDeltaCi };

/** How much of the TOTAL summed delta across the population is attributable to the top-K trades by
 *  |delta| — the direct answer to "is this being driven by a handful of outliers." A candidate whose
 *  advantage survives removing its own biggest movers is a broad edge; one that evaporates is not. */
export function deltaConcentration(tradeRows, candidateKey, ks = [1, 3, 5, 10, 20]) {
  const deltas = tradeRows.map((r) => r[candidateKey]?.delta).filter(finite);
  const n = deltas.length;
  const totalDelta = deltas.reduce((a, b) => a + b, 0);
  const sortedByAbs = [...deltas].sort((a, b) => Math.abs(b) - Math.abs(a));
  return {
    n,
    totalDelta: round2(totalDelta),
    byTopK: ks
      .filter((k) => k <= n)
      .map((k) => {
        const topSum = sortedByAbs.slice(0, k).reduce((a, b) => a + b, 0);
        return { k, sumTopK: round2(topSum), sharePct: totalDelta !== 0 ? round2((topSum / totalDelta) * 100) : null };
      }),
  };
}

/** Recompute the mean-delta CI/verdict with the K trades carrying the largest |delta| removed — the
 *  direct "does the verdict survive without its own outliers" check. */
export function leaveOutTopKVerdict(tradeRows, candidateKey, k) {
  const withDelta = tradeRows.filter((r) => finite(r[candidateKey]?.delta));
  const sorted = [...withDelta].sort((a, b) => Math.abs(b[candidateKey].delta) - Math.abs(a[candidateKey].delta));
  const removedIds = new Set(sorted.slice(0, k).map((r) => r.id));
  const remaining = withDelta.filter((r) => !removedIds.has(r.id));
  return { removedN: Math.min(k, withDelta.length), ...meanDeltaCi(remaining.map((r) => r[candidateKey].delta)) };
}

/** Trimmed-mean robustness: drop the top/bottom `trimPct`% of deltas by VALUE (not |value|) and
 *  recompute the mean — a candidate whose mean flips sign under a mild trim is fragile. */
export function trimmedMeanDelta(tradeRows, candidateKey, trimPct = 5) {
  const deltas = tradeRows.map((r) => r[candidateKey]?.delta).filter(finite).sort((a, b) => a - b);
  const n = deltas.length;
  const cut = Math.floor(n * (trimPct / 100));
  const trimmed = deltas.slice(cut, n - cut);
  if (trimmed.length === 0) return { n: 0, trimmedMean: null };
  return { n: trimmed.length, trimmedMean: round2(trimmed.reduce((a, b) => a + b, 0) / trimmed.length) };
}

/** Full aggregate metric bundle for one candidate against current, over one population — everything
 *  the operator asked for in one call: win rate, expectancy, median, total return + drawdown (equity
 *  curve), profit factor, reach rate, avg MFE-capture%, avg giveback, stop rate. `rows` must already
 *  be chronologically sorted (by closedAt/committedAt) for the equity-curve figures to mean anything. */
export function aggregateHeadToHead(tradeRows, candidateKey) {
  const usable = tradeRows.filter((r) => finite(r.current) && r[candidateKey] && finite(r[candidateKey].realizedPnlPct));
  const n = usable.length;
  if (n === 0) return { n: 0, verdict: "NO DATA" };

  const candVals = usable.map((r) => r[candidateKey].realizedPnlPct);
  const curVals = usable.map((r) => r.current);
  const sorted = (arr) => [...arr].sort((a, b) => a - b);
  const median = (arr) => {
    const v = sorted(arr);
    const m = Math.floor(v.length / 2);
    return v.length === 0 ? null : v.length % 2 === 0 ? round2((v[m - 1] + v[m]) / 2) : round2(v[m]);
  };

  const wins = usable.filter((r) => r[candidateKey].realizedPnlPct > 0);
  const losses = usable.filter((r) => r[candidateKey].realizedPnlPct <= 0);
  const winRate = round2((wins.length / n) * 100);
  const avgWinner = wins.length ? round2(wins.reduce((a, r) => a + r[candidateKey].realizedPnlPct, 0) / wins.length) : null;
  const avgLoser = losses.length ? round2(losses.reduce((a, r) => a + r[candidateKey].realizedPnlPct, 0) / losses.length) : null;
  const expectancy =
    avgWinner != null && avgLoser != null
      ? round2((wins.length / n) * avgWinner + (losses.length / n) * avgLoser)
      : (avgWinner ?? avgLoser);
  const sumPos = wins.reduce((a, r) => a + r[candidateKey].realizedPnlPct, 0);
  const sumNegAbs = Math.abs(losses.reduce((a, r) => a + r[candidateKey].realizedPnlPct, 0));
  const profitFactor = sumNegAbs > 0 ? round2(sumPos / sumNegAbs) : sumPos > 0 ? Infinity : null;

  const triggeredCount = usable.filter((r) => r[candidateKey].triggered === true).length;
  const stopRate = round2((usable.filter((r) => r.scaleOutAction === "STOP_OUT").length / n) * 100);

  const givebackVals = usable.map((r) => r[candidateKey].givebackPts).filter(finite);
  const mfeCapVals = usable.map((r) => r[candidateKey].mfeCapturedPct).filter(finite);

  const curveCandidate = equityCurveStats(candVals);
  const curveCurrent = equityCurveStats(curVals);

  const deltas = usable.map((r) => r[candidateKey].delta).filter(finite);
  const { meanDelta, ci, verdict } = meanDeltaCi(deltas);

  return {
    n,
    triggeredCount,
    reachRatePct: round2((triggeredCount / n) * 100),
    stopRatePct: stopRate,
    winRate,
    avgWinner,
    avgLoser,
    medianRealized: median(candVals),
    medianCurrent: median(curVals),
    expectancy,
    profitFactor,
    avgGivebackPts: givebackVals.length ? round2(givebackVals.reduce((a, b) => a + b, 0) / givebackVals.length) : null,
    avgMfeCapturedPct: mfeCapVals.length ? round2(mfeCapVals.reduce((a, b) => a + b, 0) / mfeCapVals.length) : null,
    totalReturnPtsCandidate: curveCandidate.totalReturnPts,
    totalReturnPtsCurrent: curveCurrent.totalReturnPts,
    maxDrawdownPtsCandidate: curveCandidate.maxDrawdownPts,
    maxDrawdownPtsCurrent: curveCurrent.maxDrawdownPts,
    meanDelta,
    ci,
    verdict,
    concentration: deltaConcentration(usable, candidateKey),
    leaveOutTop1: leaveOutTopKVerdict(usable, candidateKey, 1),
    leaveOutTop5: leaveOutTopKVerdict(usable, candidateKey, 5),
    leaveOutTop10: leaveOutTopKVerdict(usable, candidateKey, 10),
    trimmedMean5pct: trimmedMeanDelta(usable, candidateKey, 5),
  };
}
