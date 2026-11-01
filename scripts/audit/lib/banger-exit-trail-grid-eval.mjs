/**
 * BANGER EXIT TRAIL-SWEEP OPTIMIZATION GRID (operator directive 2026-09-27, follow-up to the
 * head-to-head validation, PR #5517). That validation only varied the PARTIAL trigger% and
 * fraction%, always inheriting production's own REAL 50%-of-peak runner trail unchanged (the
 * summary-tier data has no per-tick path, so the runner's fate was always "ride to whatever the
 * real recorded terminal outcome was"). This module adds the third axis the operator asked for:
 * sweeping the runner's OWN trailing-stop percentage (40/50/60/70% of peak), which the real data
 * cannot observe directly for any level other than production's actual 50% — so it must be
 * RECONSTRUCTED under an explicit, disclosed assumption. Read this header before trusting a number.
 *
 * THE ASSUMPTION (single-peaked-path -- the SAME one already named and disclosed in
 * swing-exit-optimization-eval.mjs and banger-exit-headtohead-eval.mjs, extended, not replaced):
 * the underlying's real price path, for the runner portion, is well-approximated as ONE monotonic
 * decline from `peak_premium` (a true, complete running max -- these are all CLOSED rows, so the
 * max is final, not still accumulating) down to the REAL recorded terminal return
 * (`syntheticFullReturnPct`, imported unmodified from banger-exit-headtohead-eval.mjs -- the exact
 * PR #5517 reconstruction the operator asked to reuse). Under that assumption, a trail level T
 * (e.g. 0.60 = exit at 60% of peak) is reachable if and only if the decline from peak down to the
 * real terminal point PASSES THROUGH peak*T -- i.e. peak*T lies between peak and the real terminal
 * mark. This gives one clean, general rule for ANY tested T:
 *
 *   runnerExitPct(T) = max( hypotheticalLevel(T), realTerminalPct )
 *
 * where hypotheticalLevel(T) is peak*T expressed as a % return on entry. Read: if the tested trail
 * sits ABOVE where the real position actually ended up, the monotonic decline necessarily crosses
 * it first (a real, supported claim) -- exit there. If the tested trail sits AT OR BELOW the real
 * ending point, there is no evidence in this data that the price ever fell that far (the real
 * position closed before reaching it, by definition) -- so it rides to the real terminal point
 * unchanged, the same "never reached, ride through" convention every other module in this toolkit
 * already uses for an untested/unreached level.
 *
 * WHY THIS IS SAFE, NOT A GUESS: `max()` is monotonically consistent with peak >= real terminal
 * (true for every EXIT_RUNNER/EXPIRED row: peak is the position's own all-time high, so it is >= any
 * later closing point) -- a looser trail (higher T) can only produce a result >= a tighter trail's,
 * matching intuition (lock in more of the peak, or ride through unchanged; never worse than the
 * real recorded outcome for T above it, per this same logic applied at every T).
 *
 * THE CONTROL CELL IS EXACT, NOT APPROXIMATE: when the tested config is EXACTLY production's own
 * real rule (trigger=100, fraction=0.5, trail=0.5), this module bypasses the geometric
 * reconstruction entirely and returns `current` directly -- the same proof discipline PR #5517
 * established (candidateEqualsCurrent), now guaranteed by construction rather than merely close
 * (discrete 5-minute polling means the REAL close can land a hair below the theoretical peak*0.5
 * crossing -- close enough to be invisible in aggregate, but the control MUST show a literal zero
 * delta against itself, not a rounding artifact).
 *
 * PURE AND TOTAL: no IO, no clock, no throw. Reuses `syntheticFullReturnPct`/`equityCurveStats`/
 * `meanDeltaCi` from banger-exit-headtohead-eval.mjs and `mfeCapturedPct` from
 * swing-exit-optimization-eval.mjs UNMODIFIED -- never reimplements proven math.
 */
import { syntheticFullReturnPct, equityCurveStats, meanDeltaCi } from "./banger-exit-headtohead-eval.mjs";
import { mfeCapturedPct } from "./swing-exit-optimization-eval.mjs";

export const TRIGGER_LEVELS_PCT = [100, 125, 150, 175, 200];
export const SCALE_FRACTIONS = [0.33, 0.5, 0.67];
export const TRAIL_FRACTIONS = [0.4, 0.5, 0.6, 0.7];
export const PRODUCTION_CONFIG = { triggerPct: 100, fraction: 0.5, trailFrac: 0.5 };

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

function isProductionConfig(cfg) {
  return cfg.triggerPct === PRODUCTION_CONFIG.triggerPct && cfg.fraction === PRODUCTION_CONFIG.fraction && cfg.trailFrac === PRODUCTION_CONFIG.trailFrac;
}

/** One row, one (trigger, fraction, trail) config. Mirrors `evaluateSummaryTierGridCell`'s output
 *  shape exactly (realizedPnlPct/triggered/mfeCapturedPct) so it composes with the rest of this
 *  toolkit's trade-row/aggregate machinery unchanged. */
export function evaluateTrailGridCell(row, cfg) {
  const entry = finite(row?.entry_premium) ? row.entry_premium : null;
  const peak = finite(row?.peak_premium) ? row.peak_premium : null;
  const current = finite(row?.realized_pnl_pct) ? row.realized_pnl_pct : null;
  if (!(entry > 0) || peak == null || current == null) return null;

  if (isProductionConfig(cfg)) {
    return { realizedPnlPct: current, triggered: peak >= entry * 2.0, mfeCapturedPct: mfeCapturedPct(current, entry, peak) };
  }

  const level = entry * (1 + cfg.triggerPct / 100);
  const triggered = peak >= level;
  const realTerminalPct = syntheticFullReturnPct(row);
  if (!triggered) {
    // No partial ever fires under THIS candidate (its trigger was never reached) -- the ENTIRE
    // position rides unscaled from entry to its real underlying fate, exactly the same "ride the
    // raw single-leg return" convention swing-exit-optimization-eval.mjs's own untriggered case
    // uses. This is deliberately NOT `current`: `current` is production's OWN real blended value,
    // which already banked a DIFFERENT real partial (at production's own 100% trigger) that this
    // candidate, by construction, never takes -- reusing it here would silently pretend the
    // candidate got a safety-net partial it does not have, hiding exactly the downside risk this
    // sweep exists to measure (caught by a real-row regression test after a first draft bug did
    // exactly this and made every flipped-winner count read as zero).
    if (realTerminalPct == null) return null;
    return { realizedPnlPct: realTerminalPct, triggered: false, mfeCapturedPct: mfeCapturedPct(realTerminalPct, entry, peak) };
  }

  const peakPct = (peak / entry - 1) * 100;
  const hypotheticalLevelPct = 100 * (cfg.trailFrac - 1) + cfg.trailFrac * peakPct;
  const runnerExitPct = realTerminalPct == null ? null : Math.max(hypotheticalLevelPct, realTerminalPct);
  if (runnerExitPct == null) return null;

  const realizedPnlPct = round2(cfg.fraction * cfg.triggerPct + (1 - cfg.fraction) * runnerExitPct);
  return { realizedPnlPct, triggered: true, mfeCapturedPct: mfeCapturedPct(realizedPnlPct, entry, peak) };
}

/** One row's full comparison across every named (trigger,fraction,trail) config -- same shape
 *  discipline as banger-exit-headtohead-eval.mjs's buildTradeRow. `configs` is {key: cfg}. */
export function buildGridTradeRow(row, configs) {
  const entry = finite(row.entry_premium) ? row.entry_premium : null;
  const peak = finite(row.peak_premium) ? row.peak_premium : null;
  const current = finite(row.realized_pnl_pct) ? row.realized_pnl_pct : null;
  const peakPct = entry > 0 && peak != null ? round2((peak / entry - 1) * 100) : null;

  const out = {
    id: row.id,
    ticker: row.ticker,
    sessionDate: row.session_date,
    entryPremium: entry,
    peakPremium: peak,
    scaleOutAction: row.scale_out_action,
    current,
    peakPct,
  };
  for (const [key, cfg] of Object.entries(configs)) {
    const c = evaluateTrailGridCell(row, cfg);
    out[key] = c
      ? {
          realizedPnlPct: c.realizedPnlPct,
          triggered: c.triggered,
          mfeCapturedPct: c.mfeCapturedPct,
          delta: current != null && c.realizedPnlPct != null ? round2(c.realizedPnlPct - current) : null,
        }
      : null;
  }
  return out;
}

/** Winner-preservation metrics for one config against `current` -- the "what do we sacrifice" half
 *  the operator asked for on every cell, not just the leading candidate. */
export function winnerFlipMetrics(tradeRows, key, largeWinnerThresholdPct = 50) {
  const usable = tradeRows.filter((r) => finite(r.current) && r[key] && finite(r[key].realizedPnlPct));
  const actualWinners = usable.filter((r) => r.current > 0);
  const flipped = actualWinners.filter((r) => r[key].realizedPnlPct <= 0);
  const largeWinners = usable.filter((r) => r.current >= largeWinnerThresholdPct);
  const degraded = largeWinners.filter((r) => r[key].realizedPnlPct < r.current * 0.5);
  return {
    actualWinnersN: actualWinners.length,
    flippedToLoserN: flipped.length,
    flippedToLoserRatePct: actualWinners.length ? round2((flipped.length / actualWinners.length) * 100) : null,
    largeWinnersN: largeWinners.length,
    degradedN: degraded.length,
    degradedRatePct: largeWinners.length ? round2((degraded.length / largeWinners.length) * 100) : null,
  };
}

/** Full metric bundle for one config: expectancy, profit factor, max drawdown (equity curve),
 *  median return, win rate, reach rate, winner-flip metrics -- everything requested per cell. */
export function aggregateGridConfig(tradeRows, key) {
  const usable = tradeRows.filter((r) => finite(r.current) && r[key] && finite(r[key].realizedPnlPct));
  const n = usable.length;
  if (n === 0) return { n: 0, verdict: "NO DATA" };

  const vals = usable.map((r) => r[key].realizedPnlPct);
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianRealized = sorted.length % 2 === 0 ? round2((sorted[mid - 1] + sorted[mid]) / 2) : round2(sorted[mid]);

  const wins = usable.filter((r) => r[key].realizedPnlPct > 0);
  const losses = usable.filter((r) => r[key].realizedPnlPct <= 0);
  const winRate = round2((wins.length / n) * 100);
  const sumPos = wins.reduce((a, r) => a + r[key].realizedPnlPct, 0);
  const sumNegAbs = Math.abs(losses.reduce((a, r) => a + r[key].realizedPnlPct, 0));
  const profitFactor = sumNegAbs > 0 ? round2(sumPos / sumNegAbs) : sumPos > 0 ? Infinity : null;
  const expectancy = round2(vals.reduce((a, b) => a + b, 0) / n);

  const triggeredCount = usable.filter((r) => r[key].triggered === true).length;
  const curve = equityCurveStats(vals);
  const flips = winnerFlipMetrics(usable, key);

  const deltas = usable.map((r) => r[key].delta).filter(finite);
  const { meanDelta, ci, verdict } = meanDeltaCi(deltas);

  return {
    n,
    reachRatePct: round2((triggeredCount / n) * 100),
    winRate,
    medianRealized,
    expectancy,
    profitFactor,
    maxDrawdownPts: curve.maxDrawdownPts,
    totalReturnPts: curve.totalReturnPts,
    ...flips,
    meanDelta,
    ci,
    verdict,
  };
}

/** The full trigger x fraction x trail grid, including the exact production control cell. */
export function runTrailGrid(rows) {
  const configs = {};
  for (const triggerPct of TRIGGER_LEVELS_PCT) {
    for (const fraction of SCALE_FRACTIONS) {
      for (const trailFrac of TRAIL_FRACTIONS) {
        configs[`t${triggerPct}_f${Math.round(fraction * 100)}_r${Math.round(trailFrac * 100)}`] = { triggerPct, fraction, trailFrac };
      }
    }
  }
  const tradeRows = rows.map((row) => buildGridTradeRow(row, configs));
  return Object.entries(configs).map(([key, cfg]) => ({
    key,
    ...cfg,
    isControl: isProductionConfig(cfg),
    ...aggregateGridConfig(tradeRows, key),
  }));
}

/**
 * Pareto frontier over three objectives: maximize expectancy, minimize |max drawdown|, minimize
 * winners-flipped-to-loser rate. A cell is on the frontier if no other cell is at least as good on
 * all three and strictly better on at least one (standard non-dominated-set definition). Cells with
 * insufficient data (n===0 or a null metric) are excluded rather than silently treated as "best".
 */
export function paretoFrontier(cells) {
  const usable = cells.filter((c) => finite(c.expectancy) && finite(c.maxDrawdownPts) && finite(c.flippedToLoserRatePct));
  const dominates = (a, b) =>
    a.expectancy >= b.expectancy &&
    Math.abs(a.maxDrawdownPts) <= Math.abs(b.maxDrawdownPts) &&
    a.flippedToLoserRatePct <= b.flippedToLoserRatePct &&
    (a.expectancy > b.expectancy || Math.abs(a.maxDrawdownPts) < Math.abs(b.maxDrawdownPts) || a.flippedToLoserRatePct < b.flippedToLoserRatePct);
  return usable.filter((c) => !usable.some((other) => other.key !== c.key && dominates(other, c)));
}
