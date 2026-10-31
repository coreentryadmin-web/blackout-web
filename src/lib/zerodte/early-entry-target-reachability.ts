// EARLY-ENTRY $10/$20 TARGET REACHABILITY — the real Black-Scholes answer to "how far would the
// underlying have to move, and under what IV, for THIS contract to actually be worth $10/$20,"
// not just the intrinsic-only approximation `reachabilityToPremiumTarget` (strike-reachability.ts)
// already ships (disclosed there as "a conservative, farther-than-strictly-necessary required-
// move estimate" because it ignores extrinsic value entirely).
//
// OPERATOR'S OWN WORDS: "Estimate the underlying move and time required for each contract to
// reach $10 and $20, including plausible IV changes and time decay. Reject candidates whose
// targets require implausible moves for the remaining time."
//
// METHOD: numerically invert the SAME real `blackScholesEstimate` (early-entry-value-scenarios.ts)
// the contract's own displayed value estimate already uses — bisection on spot, since a European
// BS value is strictly monotonic in spot for a fixed strike/side (increasing for a call,
// decreasing for a put). Evaluated under THREE scenarios, not one, because "plausible IV change"
// and "time decay" are both named explicitly:
//   - "now"       : current IV, full remaining time (the optimistic, immediate case).
//   - "decayed"   : current IV, HALF the remaining time (the move has to arrive faster per unit
//                   time once theta has already eaten into the window).
//   - "vol_shock" : IV x1.5, full remaining time (a real breakout/catalyst day's IV expansion,
//                   not invented — the same 1.5x "vol shock" multiplier early-entry-value-
//                   scenarios.ts already uses for its own by_volatility table).
// Every scenario's reachability_prob reuses the SAME reflection-principle touch-probability proxy
// already used throughout this directory (strike-reachability.ts's own header) — just evaluated
// at the required-move distance instead of the strike distance.
//
// STRUCTURAL IMPOSSIBILITY, NEVER HIDDEN: a put's BS value is bounded above by `strike` as spot
// approaches 0 (r=0 limit); a target >= strike is impossible for a put via ANY underlying move —
// reported honestly as `reachable: false, impossible: true`, not a huge/undefined required move.

import { blackScholesEstimate } from "./early-entry-value-scenarios";

const MINUTES_IN_TRADING_YEAR = 252 * 390;

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function standardNormalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export type TargetScenarioKey = "now" | "decayed" | "vol_shock";

export type TargetScenarioResult = {
  scenario: TargetScenarioKey;
  reachable: boolean;
  /** True only for a put whose target >= strike — structurally impossible via any underlying
   *  move, not a search failure. `reachable` is also false in this case. */
  impossible: boolean;
  required_underlying_price: number | null;
  required_move_pct: number | null;
  reachability_prob: number | null;
};

export type TargetReachabilityResult = {
  target_premium: number;
  scenarios: TargetScenarioResult[];
};

/** Bisect for the spot price at which blackScholesEstimate(...) first reaches `target`, given a
 *  fixed strike/side/iv/minutesRemaining. Null if BS is non-computable (missing iv) at this
 *  scenario's inputs. Max 60 iterations -- BS is smooth/monotonic, converges in under 40 for any
 *  realistic bound. */
function solveForSpot(
  strike: number,
  side: "call" | "put",
  iv: number,
  minutesRemaining: number,
  target: number,
  currentSpot: number
): number | null {
  const valueAt = (s: number) => blackScholesEstimate({ spot: s, strike, side, iv, minutesRemaining });

  if (side === "put") {
    // Put value is bounded above by `strike` (the r=0, S->0 limit) -- structurally impossible
    // target is handled by the caller before this is ever invoked.
    let lo = 1e-6;
    let hi = Math.max(currentSpot, strike);
    // Ensure hi actually brackets a value BELOW target (put value decreases as spot increases).
    let hiVal = valueAt(hi);
    let guard = 0;
    while (hiVal != null && hiVal > target && guard < 20) {
      hi *= 1.5;
      hiVal = valueAt(hi);
      guard++;
    }
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const v = valueAt(mid);
      if (v == null) return null;
      if (v > target) lo = mid;
      else hi = mid;
    }
    return Math.round(((lo + hi) / 2) * 100) / 100;
  }

  // Call value increases as spot increases, unbounded -- expand the upper bound until it
  // brackets the target.
  let lo = 0;
  let hi = Math.max(currentSpot, strike) + target + 1;
  let hiVal = valueAt(hi);
  let guard = 0;
  while (hiVal != null && hiVal < target && guard < 20) {
    hi *= 1.5;
    hiVal = valueAt(hi);
    guard++;
  }
  if (hiVal == null) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = valueAt(mid);
    if (v == null) return null;
    if (v < target) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
}

function expectedMovePct(spot: number, iv: number, minutesRemaining: number): number {
  return iv * Math.sqrt(Math.max(0, minutesRemaining) / MINUTES_IN_TRADING_YEAR) * 100;
}

/**
 * Pure. For each of the three scenarios described in this file's header, solves for the real
 * underlying move required for THIS contract's Black-Scholes value to reach `targetPremium`, and
 * the same reflection-principle touch-probability proxy evaluated at that distance. Returns null
 * scenarios (not a fabricated number) when `iv` is missing — same discipline as
 * `estimateContractValueScenarios`.
 */
export function targetReachabilityScenarios(input: {
  spot: number;
  strike: number;
  side: "call" | "put";
  iv: number | null;
  minutesRemaining: number;
  targetPremium: number;
}): TargetReachabilityResult | null {
  const { spot, strike, side, iv, minutesRemaining, targetPremium } = input;
  if (!(spot > 0) || !(strike > 0) || iv == null || !(iv > 0)) return null;

  const scenarioInputs: Array<{ key: TargetScenarioKey; iv: number; minutesRemaining: number }> = [
    { key: "now", iv, minutesRemaining },
    { key: "decayed", iv, minutesRemaining: Math.max(1, minutesRemaining * 0.5) },
    { key: "vol_shock", iv: iv * 1.5, minutesRemaining },
  ];

  const scenarios: TargetScenarioResult[] = scenarioInputs.map(({ key, iv: scenIv, minutesRemaining: scenMin }) => {
    if (side === "put" && targetPremium >= strike) {
      return { scenario: key, reachable: false, impossible: true, required_underlying_price: null, required_move_pct: null, reachability_prob: null };
    }
    const requiredSpot = solveForSpot(strike, side, scenIv, scenMin, targetPremium, spot);
    if (requiredSpot == null) {
      return { scenario: key, reachable: false, impossible: false, required_underlying_price: null, required_move_pct: null, reachability_prob: null };
    }
    const requiredMovePct = spot > 0 ? ((requiredSpot - spot) / spot) * 100 : null;
    const em = expectedMovePct(spot, scenIv, scenMin);
    let reachabilityProb: number | null = null;
    if (requiredMovePct != null && em > 0) {
      const z = Math.abs(requiredMovePct) / em;
      reachabilityProb = Math.min(1, Math.max(0, 2 * (1 - standardNormalCdf(z))));
    }
    return {
      scenario: key,
      reachable: true,
      impossible: false,
      required_underlying_price: requiredSpot,
      required_move_pct: requiredMovePct != null ? Math.round(requiredMovePct * 10000) / 10000 : null,
      reachability_prob: reachabilityProb != null ? Math.round(reachabilityProb * 10000) / 10000 : null,
    };
  });

  return { target_premium: targetPremium, scenarios };
}

/** Honest plausibility gate: is reaching `targetPremium` even remotely plausible given the
 *  remaining time, under the MOST FAVORABLE of the three scenarios (vol_shock, since a real
 *  breakout usually comes with IV expansion, not flat IV)? A candidate whose best-case
 *  reachability_prob falls under `minProb` is flagged implausible -- ADVISORY ONLY (see this
 *  module's own call sites: not wired as a hard reject anywhere yet, pending forward paper-test
 *  evidence per the no-historical-IV limitation disclosed in early-entry-big-target-backtest.mjs). */
export function isTargetPlausible(result: TargetReachabilityResult | null, minProb = 0.02): boolean {
  if (result == null) return true; // no real IV to judge by -- never reject from a missing input
  const best = result.scenarios.find((s) => s.scenario === "vol_shock");
  if (best == null || best.impossible) return !best?.impossible;
  if (!best.reachable) return true; // couldn't solve -- don't reject from a solver failure
  return (best.reachability_prob ?? 1) >= minProb;
}
