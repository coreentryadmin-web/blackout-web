/**
 * Night Hawk — the THREE per-horizon scorers (remodel slice 5).
 *
 * The user's hard requirement: "0dte pick logic is different, swings is different, and also leaps."
 * horizon-plays.ts already fans one candidate across the three DTE windows; this module is the missing
 * brain that rates the SAME name through three DIFFERENT lenses, because what makes a great same-day
 * lotto is not what makes a great multi-week position:
 *
 *   ZERO_DTE (same-day)   — "hot right now": institutional flow quality + dealer-gamma pull + sweep
 *                            urgency + intraday trend alignment. A fast, flow-led read; nothing about
 *                            multi-day structure matters when the contract expires today.
 *   SWING (2–30 DTE)      — "a move that's building": multi-day momentum + persistent accumulation
 *                            (flow aligned across sessions, not one print) + trend structure + relative
 *                            strength. The banger thesis — catch a developing move, not a scalp.
 *   LEAPS (31–90 DTE)     — "a durable thesis": long-trend durability (above the 200-day, higher lows)
 *                            + 3-month relative strength + option liquidity depth (you must be able to
 *                            get out weeks from now) + a real catalyst window. Slow, structure-led.
 *
 * Each scorer returns a 0–100 conviction plus the component breakdown that argued it (same shape as
 * flow-quality.ts, so the desk can render WHY a lane rated a name). These feed HorizonCandidate.
 * horizonScores, where a per-lane score COMMITs or WATCHes against that lane's floor (horizons.ts).
 *
 * PURE & deterministic — no IO. Callers normalize raw provider signals into the documented 0–1 inputs
 * (the helper normalizers here do the grounded mappings); this module only weighs them. The wiring slice
 * feeds each scorer from its real source: flow-quality/GEX for 0DTE, multi-day flow + bars for Swing,
 * daily bars + EMAs + chain depth for LEAPS.
 */

import type { Horizon } from "./horizons";

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;
/** A 0–1 sub-score, guarded: non-finite/absent → 0 (a missing signal argues nothing, never lifts). */
const unit = (n: number | null | undefined): number => (n != null && Number.isFinite(n) ? clamp(n, 0, 1) : 0);

export interface HorizonScore {
  horizon: Horizon;
  /** 0–100 conviction — the number that COMMITs/WATCHes against the lane floor. */
  score: number;
  /** Per-component contribution (points, already weighted) so the desk can render the WHY. */
  components: Record<string, number>;
  /** One-line human summary. */
  reason: string;
}

// ── grounded normalizers (raw signal → 0–1) ────────────────────────────────────────

/** Multi-day return % → 0–1 momentum. A ~+8% move over the lookback saturates the read. */
export function momentumFromReturnPct(returnPct: number | null | undefined, saturateAtPct = 8): number {
  if (returnPct == null || !Number.isFinite(returnPct)) return 0;
  return clamp(returnPct / saturateAtPct, 0, 1); // shorts express via a SHORT candidate; scorer sees the aligned magnitude
}

/** Accumulation persistence: fraction of the recent sessions whose net flow agreed with the direction. */
export function accumulationPersistence(alignedDays: number | null | undefined, totalDays: number | null | undefined): number {
  const a = alignedDays ?? 0;
  const t = totalDays ?? 0;
  if (!(t > 0) || !Number.isFinite(a) || !Number.isFinite(t)) return 0;
  return clamp(a / t, 0, 1);
}

/** Trend-stack alignment: price above a rising EMA20 above EMA50 (Swing) — each rung is worth a third. */
export function trendStackScore(input: {
  priceAboveEma20?: boolean;
  ema20AboveEma50?: boolean;
  ema50Rising?: boolean;
}): number {
  let s = 0;
  if (input.priceAboveEma20) s += 1 / 3;
  if (input.ema20AboveEma50) s += 1 / 3;
  if (input.ema50Rising) s += 1 / 3;
  return clamp(s, 0, 1);
}

/** Long-trend durability for LEAPS: above the 200-day, a rising 200-day, and a higher-low structure. */
export function trendDurabilityScore(input: {
  priceAboveEma200?: boolean;
  ema200Rising?: boolean;
  higherLows?: boolean;
}): number {
  let s = 0;
  if (input.priceAboveEma200) s += 0.45; // the single most important LEAPS gate
  if (input.ema200Rising) s += 0.3;
  if (input.higherLows) s += 0.25;
  return clamp(s, 0, 1);
}

/** Relative strength vs SPY over the lookback: the name's return minus SPY's, in % → 0–1 (±6% band). */
export function relativeStrengthScore(nameReturnPct: number | null | undefined, spyReturnPct: number | null | undefined, bandPct = 6): number {
  if (nameReturnPct == null || spyReturnPct == null || !Number.isFinite(nameReturnPct) || !Number.isFinite(spyReturnPct)) return 0;
  return clamp((nameReturnPct - spyReturnPct) / bandPct, 0, 1) ; // only OUTperformance counts (clamped at 0)
}

/** Option liquidity depth at the chosen LEAPS strike: OI and daily volume both matter (min-of the two reads). */
export function liquidityDepthScore(openInterest: number | null | undefined, volume: number | null | undefined, oiFull = 2000, volFull = 500): number {
  const oi = clamp((openInterest ?? 0) / oiFull, 0, 1);
  const vol = clamp((volume ?? 0) / volFull, 0, 1);
  return Math.min(oi, vol); // a strike is only tradeable weeks out if BOTH standing size and flow exist
}

// ── the three scorers ───────────────────────────────────────────────────────────────

export interface ZeroDteScoreInput {
  /** 0–100 from computeFlowQuality (flow-quality.ts) — the primary trigger. */
  flowQuality: number | null;
  /** Dealer-gamma pull toward the trade in the direction, 0–1 (spot magnetized to the GEX king / flip). */
  gammaPull?: number | null;
  /** Sweep-share urgency 0–1 (aggressive at-the-ask sweeps vs passive fills). */
  sweepUrgency?: number | null;
  /** Intraday trend agreement with the direction, 0–1 (5m trend + VWAP side). */
  intradayAlign?: number | null;
}

const ZERO_DTE_W = { flowQuality: 45, gammaPull: 20, sweepUrgency: 15, intradayAlign: 20 };

/** ZERO_DTE lens: flow-led, same-day. Flow quality dominates; gamma/urgency/trend fine-tune. */
export function scoreZeroDte(input: ZeroDteScoreInput): HorizonScore {
  const fq = input.flowQuality != null && Number.isFinite(input.flowQuality) ? clamp(input.flowQuality / 100, 0, 1) : 0;
  const components = {
    flowQuality: round1(fq * ZERO_DTE_W.flowQuality),
    gammaPull: round1(unit(input.gammaPull) * ZERO_DTE_W.gammaPull),
    sweepUrgency: round1(unit(input.sweepUrgency) * ZERO_DTE_W.sweepUrgency),
    intradayAlign: round1(unit(input.intradayAlign) * ZERO_DTE_W.intradayAlign),
  };
  const score = clamp(Object.values(components).reduce((a, b) => a + b, 0), 0, 100);
  return {
    horizon: "ZERO_DTE",
    score: Math.round(score),
    components,
    reason: `flow ${Math.round(fq * 100)}/100${input.gammaPull ? `, gamma pull ${Math.round(unit(input.gammaPull) * 100)}%` : ""}`,
  };
}

export interface SwingScoreInput {
  /** Multi-day momentum 0–1 (momentumFromReturnPct over ~10 sessions). */
  momentum: number | null;
  /** Persistent accumulation 0–1 (flow aligned across sessions — accumulationPersistence). */
  accumulation: number | null;
  /** Trend-stack alignment 0–1 (trendStackScore). */
  trendStack?: number | null;
  /** Relative strength vs SPY 0–1 (relativeStrengthScore). */
  relStrength?: number | null;
}

const SWING_W = { momentum: 30, accumulation: 30, trendStack: 25, relStrength: 15 };

/** SWING lens: a developing multi-day move. Momentum + persistent accumulation lead; trend/RS confirm. */
export function scoreSwing(input: SwingScoreInput): HorizonScore {
  const components = {
    momentum: round1(unit(input.momentum) * SWING_W.momentum),
    accumulation: round1(unit(input.accumulation) * SWING_W.accumulation),
    trendStack: round1(unit(input.trendStack) * SWING_W.trendStack),
    relStrength: round1(unit(input.relStrength) * SWING_W.relStrength),
  };
  const score = clamp(Object.values(components).reduce((a, b) => a + b, 0), 0, 100);
  return {
    horizon: "SWING",
    score: Math.round(score),
    components,
    reason: `momentum ${Math.round(unit(input.momentum) * 100)}%, accumulation ${Math.round(unit(input.accumulation) * 100)}%`,
  };
}

export interface LeapsScoreInput {
  /** Long-trend durability 0–1 (trendDurabilityScore). */
  trendDurability: number | null;
  /** 3-month relative strength vs SPY 0–1 (relativeStrengthScore, 63d). */
  relStrength: number | null;
  /** Option liquidity depth at the LEAPS strike 0–1 (liquidityDepthScore) — must be able to exit weeks out. */
  liquidityDepth?: number | null;
  /** A real catalyst inside the hold window 0–1 (earnings trajectory / durable news). */
  catalyst?: number | null;
}

// Trend durability is weighted so the CONFIRM components alone (25+15+15=55) cannot clear the 62 floor:
// a LEAPS thesis that isn't structurally durable does not commit no matter how strong the flow/RS around
// it — the "durable" in the lens name is enforced by the weighting, not just described.
const LEAPS_W = { trendDurability: 45, relStrength: 25, liquidityDepth: 15, catalyst: 15 };

/** LEAPS lens: a durable thesis you can hold weeks. Trend durability leads; RS + liquidity + catalyst confirm. */
export function scoreLeaps(input: LeapsScoreInput): HorizonScore {
  const components = {
    trendDurability: round1(unit(input.trendDurability) * LEAPS_W.trendDurability),
    relStrength: round1(unit(input.relStrength) * LEAPS_W.relStrength),
    liquidityDepth: round1(unit(input.liquidityDepth) * LEAPS_W.liquidityDepth),
    catalyst: round1(unit(input.catalyst) * LEAPS_W.catalyst),
  };
  const score = clamp(Object.values(components).reduce((a, b) => a + b, 0), 0, 100);
  return {
    horizon: "LEAPS",
    score: Math.round(score),
    components,
    reason: `trend durability ${Math.round(unit(input.trendDurability) * 100)}%, rel-strength ${Math.round(unit(input.relStrength) * 100)}%`,
  };
}
