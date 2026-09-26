/**
 * Exit-management OPTIMIZATION grid (Ask Largo standing mandate, operator directive 2026-09-26,
 * follow-up to the exit-management study). The prior study found the Banger-shaped "50% at +100%,
 * ride the runner" policy beats real historical management by +3.3pp (n=1310). This module runs a
 * deeper grid around that result: profit-take TRIGGER levels x SCALE-OUT FRACTIONS, crossed with
 * four RUNNER exit styles for the remaining size, plus the metrics (median, profit factor, drawdown,
 * MFE-capture%, winner-destruction/premature-kill rates) needed to judge each cell honestly.
 *
 * REUSES `swing-exit-simulation-eval.mjs`'s `normalizeTicks`/`findFirstGateTick` UNMODIFIED — same
 * tick shape, same shared real "gate floor" (production's own logged capital-preservation/thesis-
 * invalidation verdict), same look-ahead discipline: every rule below decides at tick i using only
 * `ticks[0..i]`. See that module's header for the full argument; not repeated here.
 *
 * DESIGN CHOICE vs the prior module: the prior module's ladder rules applied a SYNTHETIC hard-stop
 * (-60% of entry) IN ADDITION to the real gate floor. That is redundant in practice — production's
 * own `premium_stop` gate already fires at the same economic level and is already captured by the
 * real gate floor — so this module relies on the real gate floor ALONE for capital preservation
 * (never a synthetic hard-stop), which is MORE faithful to what actually happened, not less. This is
 * a deliberate simplification from the prior module, disclosed here rather than silently changed.
 *
 * RUNNER STYLES (applied to the remaining size after the ONE trim rung fires; the "thesis_risk"
 * style is the "test the existing thesis/risk exit first" baseline the operator asked for):
 *   - "thesis_risk"    — no additional logic; ride until the real gate fires or the series ends.
 *   - "trailing_stop"  — arm a trailing stop at the trim mark, exit if the mark retraces
 *                        `trailBackPct`% down from the highest mark seen since the trim.
 *   - "breakeven_stop" — exit if the mark ever falls back to the ORIGINAL entry premium (the
 *                        runner's true cost basis) after the trim.
 *   - "time_exit"      — exit exactly `holdTicksAfterTrim` ticks after the trim fires (or sooner on
 *                        a real gate).
 * A position whose trigger never fires (peak never reaches the tested level) rides 100% of size to
 * the real gate/close — the SAME `no_early_trim` outcome for every config that never triggers, which
 * is the honest behavior (a config that's rarely reachable should show that rarity, not be forced).
 *
 * BANGER (summary-tier): no per-tick history exists, so only the trigger x fraction grid under the
 * "thesis_risk" runner (= ride the SAME single-peaked-path approximation `swing-early-trim-ab.mjs`
 * already discloses) is computable. Trailing/breakeven/time-exit runner styles are N/A for Banger —
 * not guessed — because they need to know WHEN price did what, which this engine has never logged.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */
import { normalizeTicks, findFirstGateTick } from "./swing-exit-simulation-eval.mjs";

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

export const TRIGGER_LEVELS_PCT = [50, 75, 100, 125, 150, 200];
export const SCALE_OUT_FRACTIONS = [0.25, 0.33, 0.5, 0.67];

function buildContext(row) {
  const entry = finite(row?.entryPremium) ? row.entryPremium : null;
  const peak = finite(row?.peakPremium) ? row.peakPremium : null;
  const ticks = normalizeTicks(row);
  const gateIdx = findFirstGateTick(ticks);
  return { entry, peak, ticks, gateIdx };
}

function maxDrawdownAfterProfit(entry, ticks, exitIdx) {
  let peakSoFar = null;
  let worst = null;
  for (let i = 0; i <= exitIdx && i < ticks.length; i++) {
    const mark = ticks[i].mark;
    if (mark > entry) peakSoFar = peakSoFar == null ? mark : Math.max(peakSoFar, mark);
    if (peakSoFar != null) {
      const dd = ((mark - peakSoFar) / peakSoFar) * 100;
      if (worst == null || dd < worst) worst = dd;
    }
  }
  return worst == null ? null : round2(worst);
}

/**
 * "Captured X% of the peak move" is only a meaningful sentence when realizedPnlPct is itself a
 * gain (0 <= realized <= peak, or an overshoot past peak) — matches this repo's own
 * `mfeCaptureOutcome` (mfe-capture.ts) convention. Once realized goes NEGATIVE the position has
 * round-tripped past breakeven into a loss — a DIFFERENT event, not a worse "capture" — so the
 * ratio is null there rather than an unbounded, uninterpretable negative number (e.g. a position
 * with a tiny +2% peak that round-trips to -80% would otherwise report "captured -4000%", which
 * is noise, not a signal, and would silently dominate any average taken across a population).
 */
function mfeCapturedPct(realizedPnlPct, entry, peakPremium) {
  if (realizedPnlPct == null || realizedPnlPct < 0 || !(entry > 0) || !finite(peakPremium) || peakPremium <= entry) return null;
  const mfePct = ((peakPremium / entry) - 1) * 100;
  if (!(mfePct > 0)) return null;
  return round2((realizedPnlPct / mfePct) * 100);
}

function blendedPnlPct(entry, events) {
  if (!(entry > 0) || events.length === 0) return null;
  const value = events.reduce((a, e) => a + e.fraction * e.mark, 0);
  return round2(((value / entry) - 1) * 100);
}

/**
 * One grid cell, chronologically replayed against a real tick series (native swing only).
 * @param {ReturnType<typeof buildContext>} ctx
 * @param {{triggerPct:number, fraction:number, runnerStyle:'thesis_risk'|'trailing_stop'|'breakeven_stop'|'time_exit', trailBackPct?:number, holdTicksAfterTrim?:number}} cfg
 */
function simulateGridCellChronological(ctx, cfg) {
  const { entry, ticks, gateIdx } = ctx;
  if (!entry || ticks.length === 0) return null;
  const lastIdx = ticks.length - 1;
  const level = entry * (1 + cfg.triggerPct / 100);

  let trimIdx = null;
  for (let i = 0; i <= lastIdx; i++) {
    if (gateIdx != null && i === gateIdx) {
      return {
        exitIdx: i,
        events: [{ fraction: 1, mark: ticks[i].mark }],
        exitCause: "gate",
        triggered: false,
      };
    }
    if (ticks[i].mark >= level) {
      trimIdx = i;
      break;
    }
  }
  if (trimIdx == null) {
    // Trigger never reached -> ride 100% to the real gate/close (already handled by the loop above
    // reaching lastIdx without a gate); ride to the last tick.
    return {
      exitIdx: lastIdx,
      events: [{ fraction: 1, mark: ticks[lastIdx].mark }],
      exitCause: "series_end",
      triggered: false,
    };
  }

  const trimEvent = { fraction: cfg.fraction, mark: ticks[trimIdx].mark };
  const remaining = round2(1 - cfg.fraction);

  // Runner phase, starting the tick AFTER the trim.
  let runnerPeak = ticks[trimIdx].mark;
  for (let i = trimIdx + 1; i <= lastIdx; i++) {
    if (gateIdx != null && i === gateIdx) {
      return {
        exitIdx: i,
        events: [trimEvent, { fraction: remaining, mark: ticks[i].mark }],
        exitCause: "gate",
        triggered: true,
        trimIdx,
      };
    }
    const mark = ticks[i].mark;
    if (cfg.runnerStyle === "trailing_stop") {
      runnerPeak = Math.max(runnerPeak, mark);
      if (mark <= runnerPeak * (1 - (cfg.trailBackPct ?? 30) / 100)) {
        return {
          exitIdx: i,
          events: [trimEvent, { fraction: remaining, mark }],
          exitCause: "trail_stop",
          triggered: true,
          trimIdx,
        };
      }
    } else if (cfg.runnerStyle === "breakeven_stop") {
      if (mark <= entry) {
        return {
          exitIdx: i,
          events: [trimEvent, { fraction: remaining, mark }],
          exitCause: "breakeven_stop",
          triggered: true,
          trimIdx,
        };
      }
    } else if (cfg.runnerStyle === "time_exit") {
      if (i - trimIdx >= (cfg.holdTicksAfterTrim ?? 5)) {
        return {
          exitIdx: i,
          events: [trimEvent, { fraction: remaining, mark }],
          exitCause: "time_exit",
          triggered: true,
          trimIdx,
        };
      }
    }
    // "thesis_risk": no extra check, just keep walking until gate/series-end.
  }
  return {
    exitIdx: lastIdx,
    events: [trimEvent, { fraction: remaining, mark: ticks[lastIdx].mark }],
    exitCause: "series_end",
    triggered: true,
    trimIdx,
  };
}

/** Native swing: one grid cell's outcome for one row, or null if not simulable (no chronology). */
export function evaluateGridCellForRow(row, cfg) {
  const ctx = buildContext(row);
  if (ctx.entry == null || ctx.ticks.length < 2) return null;
  const outcome = simulateGridCellChronological(ctx, cfg);
  if (!outcome) return null;
  const realizedPnlPct = blendedPnlPct(ctx.entry, outcome.events);
  return {
    realizedPnlPct,
    mfeCapturedPct: mfeCapturedPct(realizedPnlPct, ctx.entry, ctx.peak),
    maxDrawdownAfterProfitPct: maxDrawdownAfterProfit(ctx.entry, ctx.ticks, outcome.exitIdx),
    exitCause: outcome.exitCause,
    triggered: outcome.triggered,
  };
}

/** Banger (summary-tier): single-peaked-path approximation, "thesis_risk" runner only (no
 *  chronology exists to test the other three styles). `row` is a BangerPositionRow-shaped raw
 *  export row (entry_premium/peak_premium/realized_pnl_pct — snake_case, matching the export). */
export function evaluateSummaryTierGridCell(row, cfg) {
  const entry = finite(row?.entry_premium) ? row.entry_premium : null;
  const peak = finite(row?.peak_premium) ? row.peak_premium : null;
  const realExit = finite(row?.realized_pnl_pct) ? row.realized_pnl_pct : null;
  if (!(entry > 0) || peak == null || realExit == null) return null;
  const level = entry * (1 + cfg.triggerPct / 100);
  const triggered = peak >= level;
  const realizedPnlPct = triggered
    ? round2(cfg.fraction * cfg.triggerPct + (1 - cfg.fraction) * realExit)
    : realExit;
  return {
    realizedPnlPct,
    mfeCapturedPct: mfeCapturedPct(realizedPnlPct, entry, peak),
    maxDrawdownAfterProfitPct: null, // not computable without chronology
    exitCause: triggered ? "trim_then_ride" : "series_end",
    triggered,
  };
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? round2((v[mid - 1] + v[mid]) / 2) : round2(v[mid]);
}

/**
 * Aggregate one grid cell's outcomes against the REAL recorded "current" outcome for the SAME
 * population — mean/median realized return, win rate, expectancy, profit factor (equal-weighted %
 * basis: sum of positive % returns / abs(sum of negative % returns)), average drawdown-after-profit,
 * average MFE-captured%, and the two failure-mode rates the operator asked for.
 * @param {{current: number, candidate: ReturnType<typeof evaluateGridCellForRow>}[]} paired
 */
export function aggregateGridCell(paired, { largeWinnerThresholdPct = 50, prematureKillFraction = 0.5 } = {}) {
  const usable = paired.filter((p) => finite(p.current) && p.candidate && finite(p.candidate.realizedPnlPct));
  const n = usable.length;
  if (n === 0) return { n: 0, verdict: "NO DATA" };

  const candVals = usable.map((p) => p.candidate.realizedPnlPct);
  const wins = usable.filter((p) => p.candidate.realizedPnlPct > 0);
  const losses = usable.filter((p) => p.candidate.realizedPnlPct <= 0);
  const winRate = round2((wins.length / n) * 100);
  const avgWinner = wins.length ? round2(wins.reduce((a, p) => a + p.candidate.realizedPnlPct, 0) / wins.length) : null;
  const avgLoser = losses.length ? round2(losses.reduce((a, p) => a + p.candidate.realizedPnlPct, 0) / losses.length) : null;
  const expectancy =
    avgWinner != null && avgLoser != null
      ? round2((wins.length / n) * avgWinner + (losses.length / n) * avgLoser)
      : (avgWinner ?? avgLoser);

  const sumPos = wins.reduce((a, p) => a + p.candidate.realizedPnlPct, 0);
  const sumNegAbs = Math.abs(losses.reduce((a, p) => a + p.candidate.realizedPnlPct, 0));
  const profitFactor = sumNegAbs > 0 ? round2(sumPos / sumNegAbs) : sumPos > 0 ? Infinity : null;

  const ddVals = usable.map((p) => p.candidate.maxDrawdownAfterProfitPct).filter(finite);
  const mfeCapVals = usable.map((p) => p.candidate.mfeCapturedPct).filter(finite);

  const meanDelta = usable.reduce((a, p) => a + (p.candidate.realizedPnlPct - p.current), 0) / n;
  const variance = n > 1 ? usable.reduce((a, p) => a + ((p.candidate.realizedPnlPct - p.current) - meanDelta) ** 2, 0) / (n - 1) : 0;
  const stderr = Math.sqrt(variance / n);
  const ci = { lo: round2(meanDelta - 1.96 * stderr), hi: round2(meanDelta + 1.96 * stderr) };
  const verdict = n < 2 ? "INSUFFICIENT N" : ci.lo > 0 ? "CANDIDATE SEPARATED (better)" : ci.hi < 0 ? "CURRENT SEPARATED (better)" : "INCONCLUSIVE";

  const actualWinners = usable.filter((p) => p.current > 0);
  const turnedWinnerIntoLoser = actualWinners.filter((p) => p.candidate.realizedPnlPct <= 0).length;
  const largeWinnersActual = usable.filter((p) => p.current >= largeWinnerThresholdPct);
  const prematurelyKilled = largeWinnersActual.filter((p) => p.candidate.realizedPnlPct < p.current * prematureKillFraction).length;
  const triggeredCount = usable.filter((p) => p.candidate.triggered === true).length;

  return {
    n,
    triggeredCount,
    reachRatePct: round2((triggeredCount / n) * 100),
    winRate,
    avgWinner,
    avgLoser,
    medianRealized: median(candVals),
    expectancy: round2(expectancy),
    profitFactor,
    avgDrawdownAfterProfit: ddVals.length ? round2(ddVals.reduce((a, b) => a + b, 0) / ddVals.length) : null,
    avgMfeCapturedPct: mfeCapVals.length ? round2(mfeCapVals.reduce((a, b) => a + b, 0) / mfeCapVals.length) : null,
    meanCurrent: round2(usable.reduce((a, p) => a + p.current, 0) / n),
    meanCandidate: round2(usable.reduce((a, p) => a + p.candidate.realizedPnlPct, 0) / n),
    meanDelta: round2(meanDelta),
    ci,
    verdict,
    turnedWinnerIntoLoser,
    turnedWinnerIntoLoserRate: actualWinners.length ? round2((turnedWinnerIntoLoser / actualWinners.length) * 100) : null,
    largeWinnerN: largeWinnersActual.length,
    prematurelyKilledLargeWinners: prematurelyKilled,
    prematurelyKilledRate: largeWinnersActual.length ? round2((prematurelyKilled / largeWinnersActual.length) * 100) : null,
  };
}

/** Full trigger x fraction grid for one population, one runner style, via a supplied per-row
 *  evaluator (native-swing chronological or Banger summary-tier). `currentOf(row)` extracts the
 *  real recorded outcome; `evalOf(row, cfg)` extracts the candidate outcome for that config. */
export function runGrid(rows, { currentOf, evalOf, runnerStyle = "thesis_risk", extraParams = {} }, opts) {
  const cells = [];
  for (const triggerPct of TRIGGER_LEVELS_PCT) {
    for (const fraction of SCALE_OUT_FRACTIONS) {
      const cfg = { triggerPct, fraction, runnerStyle, ...extraParams };
      const paired = rows.map((row) => ({ current: currentOf(row), candidate: evalOf(row, cfg) }));
      cells.push({ triggerPct, fraction, runnerStyle, ...aggregateGridCell(paired, opts) });
    }
  }
  return cells;
}

/** Splits rows into two halves by a date-extracting function, for a walk-forward/holdout check —
 *  NOT a k-fold cross-validation, just the coarsest defensible "does the early winner still win
 *  late" split this population size supports. Ties on the median date go to the earlier half. */
export function splitByDateHalves(rows, dateOf) {
  const withDates = rows.map((r) => ({ row: r, t: Date.parse(dateOf(r) ?? "") })).filter((x) => Number.isFinite(x.t));
  withDates.sort((a, b) => a.t - b.t);
  const mid = Math.ceil(withDates.length / 2);
  return {
    early: withDates.slice(0, mid).map((x) => x.row),
    late: withDates.slice(mid).map((x) => x.row),
    splitDate: withDates.length ? new Date(withDates[mid - 1]?.t ?? withDates[withDates.length - 1].t).toISOString().slice(0, 10) : null,
  };
}
