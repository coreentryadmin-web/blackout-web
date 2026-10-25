// EARLY-ENTRY contract value SCENARIOS — explicitly labeled ESTIMATES, never a quote.
//
// OPERATOR'S OWN WORDS: "Estimate contract values across underlying-price, elapsed-time, and
// volatility scenarios; label these as estimates."
//
// METHOD: a standard European Black-Scholes price (no dividend, zero risk-free rate — for a
// same-day 0DTE contract, r*T is negligible, and this codebase has no risk-free-rate input to
// plug in honestly, so it's zero rather than guessed). This is the same disclosed-approximation
// posture strike-reachability.ts already takes for its own touch-probability proxy: a standard,
// well-known formula (not an invented shortcut), explicitly NOT a substitute for a real market
// quote, and never presented as one. American-exercise / early-exercise value is NOT modeled
// (immaterial for a short-dated, typically-OTM 0DTE single-name/index option, and this codebase
// has no American-pricing model to borrow from).
//
// THREE ONE-DIMENSIONAL SENSITIVITY TABLES, not a full cross-product grid: "by_underlying_price"
// (iv/time held at current), "by_elapsed_time" (spot/iv held at current), "by_volatility"
// (spot/time held at current). A full 3-axis cross join would be dozens of numbers nobody reads;
// varying one axis at a time is exactly what "across underlying-price, elapsed-time, and
// volatility scenarios" is asking to see, and is far more legible.
//
// NEVER FABRICATED: returns null (the whole scenario set) when `iv` is missing — the operator's
// own instruction scopes this to an ESTIMATE grounded in a real implied vol, not a guessed one.

const MINUTES_IN_TRADING_YEAR = 252 * 390;

/** Abramowitz & Stegun 7.1.26 — same well-known error-function approximation
 *  strike-reachability.ts already uses (duplicated here rather than imported, since that file's
 *  own `erf`/`standardNormalCdf` are private helpers, not part of its exported surface). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function N(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Pure. Standard European Black-Scholes value (r=0). `minutesRemaining<=0` returns the
 * intrinsic value directly (the T->0 limit, avoiding a divide-by-zero in d1/d2). Null `iv` or a
 * non-positive `spot`/`strike`/`iv` returns null — never a fabricated price.
 */
export function blackScholesEstimate(input: {
  spot: number;
  strike: number;
  side: "call" | "put";
  iv: number | null;
  minutesRemaining: number;
}): number | null {
  const { spot, strike, side, iv, minutesRemaining } = input;
  if (!(spot > 0) || !(strike > 0)) return null;
  if (minutesRemaining <= 0) {
    const intrinsic = side === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    return Math.round(intrinsic * 10000) / 10000;
  }
  if (iv == null || !(iv > 0)) return null;
  const T = minutesRemaining / MINUTES_IN_TRADING_YEAR;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (iv * iv * 0.5) * T) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const value = side === "call" ? spot * N(d1) - strike * N(d2) : strike * N(-d2) - spot * N(-d1);
  return Math.round(Math.max(0, value) * 10000) / 10000;
}

export type ValuePoint = { label: string; estimated_value: number; is_estimate: true };

export type ValueScenarios = {
  base_value: number;
  by_underlying_price: ValuePoint[];
  by_elapsed_time: ValuePoint[];
  by_volatility: ValuePoint[];
} | null;

/** IV-implied 1-sigma expected move over the remaining time, as a dollar amount — same formula
 *  strike-reachability.ts's own `expected_move_pct` uses, just left in price units here so the
 *  underlying-price scenarios can be built directly from it. */
function expectedMoveDollars(spot: number, iv: number, minutesRemaining: number): number {
  return spot * iv * Math.sqrt(Math.max(0, minutesRemaining) / MINUTES_IN_TRADING_YEAR);
}

/**
 * Pure. Builds the three one-axis sensitivity tables described in this file's header. Returns
 * null when `iv` is missing or non-positive — the whole point of an "estimate" is that it is
 * grounded in a real implied vol, never invented.
 */
export function estimateContractValueScenarios(input: {
  spot: number;
  strike: number;
  side: "call" | "put";
  iv: number | null;
  minutesRemaining: number;
}): ValueScenarios {
  const { spot, strike, side, iv, minutesRemaining } = input;
  if (iv == null || !(iv > 0) || !(spot > 0) || !(strike > 0)) return null;

  const base = blackScholesEstimate({ spot, strike, side, iv, minutesRemaining });
  if (base == null) return null;

  const em = expectedMoveDollars(spot, iv, minutesRemaining);
  const priceDeltas: Array<[string, number]> = [
    ["current spot", 0],
    ["+0.5x expected move", 0.5 * em],
    ["+1x expected move", em],
    ["+1.5x expected move", 1.5 * em],
    ["-1x expected move (adverse)", -em],
  ];
  const byUnderlyingPrice: ValuePoint[] = priceDeltas.map(([label, delta]) => ({
    label,
    estimated_value: blackScholesEstimate({ spot: spot + delta, strike, side, iv, minutesRemaining }) ?? 0,
    is_estimate: true,
  }));

  const timeSlices: Array<[string, number]> = [
    ["now", minutesRemaining],
    ["halfway to the time-stop", minutesRemaining * 0.5],
    ["near the time-stop", Math.max(1, minutesRemaining * 0.1)],
  ];
  const byElapsedTime: ValuePoint[] = timeSlices.map(([label, mins]) => ({
    label,
    estimated_value: blackScholesEstimate({ spot, strike, side, iv, minutesRemaining: mins }) ?? 0,
    is_estimate: true,
  }));

  const volMultipliers: Array<[string, number]> = [
    ["current IV", 1.0],
    ["IV +20%", 1.2],
    ["IV -20%", 0.8],
    ["IV +50% (vol shock)", 1.5],
  ];
  const byVolatility: ValuePoint[] = volMultipliers.map(([label, mult]) => ({
    label,
    estimated_value: blackScholesEstimate({ spot, strike, side, iv: iv * mult, minutesRemaining }) ?? 0,
    is_estimate: true,
  }));

  return { base_value: base, by_underlying_price: byUnderlyingPrice, by_elapsed_time: byElapsedTime, by_volatility: byVolatility };
}
