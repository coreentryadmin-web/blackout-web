/**
 * Night Hawk — LEAPS signal core (remodel slice: the LEAPS lane's brain-input).
 *
 * Turns a name's fetched daily-structure reads into the LEAPS fields the candidate builder feeds to
 * scoreLeaps. The LEAPS thesis is "a durable move you can hold weeks (≤90d)," so its inputs come from:
 *   - the long-trend STRUCTURE (EMA200 position + slope + higher-lows / lower-highs): the dominant rung;
 *   - a ~3-month (63-session) price return vs SPY (relative strength);
 *   - option LIQUIDITY DEPTH at the LEAPS strike (must be able to exit weeks out);
 *   - a real CATALYST inside the hold window.
 *
 * Same DIRECTION nuance as the Swing core: a LEAPS can be LONG (a durable uptrend) or SHORT (a durable
 * downtrend), and scoreLeaps rewards ALIGNED structure. For a SHORT the bearish structure (below a FALLING
 * 200-day, lower highs) is the durable thesis and 3-month UNDERperformance is strength — so this core
 * direction-signs the return inputs and inverts the structure booleans so both express as a positive score.
 *
 * Direction comes from the caller's structure lean (bull/bear/neutral); neutral → no LEAPS candidate (a
 * name with no durable trend either way is honestly absent from the lane, never a coin-flip thesis).
 *
 * PURE & deterministic — no IO. The discovery slice fetches the reads (daily bars/EMA200 + 63d returns +
 * chain depth + catalyst) and hands them here.
 */

import type { PlayDirection } from "./horizon-fanout";

export interface LeapsReads {
  /** Long-trend lean the caller derived from EMA200 position + slope. neutral → no durable thesis. */
  structureLean: "bull" | "bear" | "neutral";
  /** Long-trend structure, stated BULLISH (price above a rising EMA200, higher lows) — inverted for SHORT. */
  priceAboveEma200?: boolean;
  ema200Rising?: boolean;
  higherLows?: boolean;
  /** ~63-session (3-month) price return %, name and SPY (RAW: an up move is positive). */
  returnPct63d: number | null;
  spyReturnPct63d: number | null;
  /** Option liquidity at the chosen LEAPS strike — must be able to exit weeks from now. */
  leapsStrikeOi?: number | null;
  leapsStrikeVol?: number | null;
  /** A real catalyst inside the hold window, 0–1 (earnings trajectory / durable news). */
  catalyst?: number | null;
}

/** The LEAPS-lane subset of RawHorizonSignals + the resolved direction (null = not a LEAPS candidate). */
export interface LeapsSignals {
  direction: PlayDirection | null;
  /** True whenever a directional structure read exists — the candidate builder's LEAPS gate. */
  hasLongTrendRead: boolean;
  /** Direction-ALIGNED durability structure (for a SHORT these carry the bearish structure). */
  priceAboveEma200?: boolean;
  ema200Rising?: boolean;
  higherLows?: boolean;
  /** Direction-signed 3-month returns (a decline is POSITIVE for a SHORT). */
  returnPct63d: number | null;
  spyReturnPct63d: number | null;
  leapsStrikeOi?: number | null;
  leapsStrikeVol?: number | null;
  catalyst?: number | null;
}

const NO_LEAPS: LeapsSignals = {
  direction: null,
  hasLongTrendRead: false,
  returnPct63d: null,
  spyReturnPct63d: null,
};

function directionFromLean(lean: "bull" | "bear" | "neutral"): PlayDirection | null {
  if (lean === "bull") return "LONG";
  if (lean === "bear") return "SHORT";
  return null;
}

/**
 * Build the LEAPS signal subset from a name's daily-structure reads. Returns NO_LEAPS (direction null → the
 * candidate builder omits the LEAPS lane) when there's no durable directional trend to anchor a weeks-long hold.
 */
export function leapsSignalsFromReads(reads: LeapsReads): LeapsSignals {
  const direction = directionFromLean(reads.structureLean);
  if (!direction) return NO_LEAPS;

  const sign = direction === "LONG" ? 1 : -1;
  const signed = (n: number | null): number | null =>
    n != null && Number.isFinite(n) ? sign * n : null;
  // For a SHORT the bullish structure is inverted into the aligned (bearish) durable read.
  const align = (bullish: boolean | undefined): boolean | undefined =>
    bullish == null ? undefined : direction === "LONG" ? bullish : !bullish;

  return {
    direction,
    hasLongTrendRead: true,
    priceAboveEma200: align(reads.priceAboveEma200),
    ema200Rising: align(reads.ema200Rising),
    higherLows: align(reads.higherLows),
    returnPct63d: signed(reads.returnPct63d),
    spyReturnPct63d: signed(reads.spyReturnPct63d),
    leapsStrikeOi: reads.leapsStrikeOi ?? null,
    leapsStrikeVol: reads.leapsStrikeVol ?? null,
    catalyst: reads.catalyst ?? null,
  };
}
