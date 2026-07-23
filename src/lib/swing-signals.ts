/**
 * Night Hawk — Swing signal core (remodel slice: the Swing lane's brain-input).
 *
 * Turns a name's fetched multi-day reads into the SWING fields the candidate builder feeds to scoreSwing.
 * The Swing thesis is "a move that's building over days," so its inputs come from:
 *   - the multi-day flow ACCUMULATION engine (flowAccumulationByTicker → ZeroDteFlowAccumulation): the
 *     directional lean + the persistence (distinct days the magnet was hit);
 *   - a ~10-session price return (momentum) and the same for SPY (relative strength);
 *   - the daily EMA stack (trend structure).
 *
 * THE DIRECTION NUANCE (the reason this is a real module, not a field copy): a Swing can be LONG or SHORT,
 * and the scorer rewards ALIGNED magnitudes. So for a SHORT (a bear accumulation), a price DECLINE is
 * strength, UNDERperformance vs SPY is strength, and the BEARISH ema stack (price below a falling EMA20
 * below EMA50) is strength. This core direction-signs every price input so both a long and a short express
 * their conviction as a positive score — passing raw (long-biased) values would score every short at ~0.
 *
 * PURE & deterministic — no IO. The discovery slice fetches the reads (flow window + daily bars/EMAs) and
 * hands them here; the caller folds these fields into a full RawHorizonSignals with the name's chain.
 */

import type { ZeroDteFlowAccumulation } from "./zerodte/flow-accumulation-context";
import type { PlayDirection } from "./horizon-fanout";

export interface SwingReads {
  /** Multi-day flow accumulation for the name (flowAccumulationByTicker), or null when no flow window. */
  accumulation: ZeroDteFlowAccumulation | null;
  /** The multi-day flow window length in sessions — the denominator for accumulation persistence. */
  flowWindowDays: number;
  /** ~10-session price return %, name and SPY (RAW: an up move is positive, regardless of direction). */
  returnPct10d: number | null;
  spyReturnPct10d: number | null;
  /** Daily EMA stack, stated BULLISH (price above a rising EMA20 above EMA50) — the core inverts for a SHORT. */
  priceAboveEma20?: boolean;
  ema20AboveEma50?: boolean;
  ema50Rising?: boolean;
}

/** The SWING-lane subset of RawHorizonSignals + the resolved direction (null = not a swing candidate). */
export interface SwingSignals {
  /** LONG on a bull lean, SHORT on a bear lean; null when the flow is neutral/absent (no swing candidate). */
  direction: PlayDirection | null;
  /** Direction-signed 10-session return (a down move is POSITIVE for a SHORT). */
  returnPct10d: number | null;
  /** Direction-signed SPY return, so relative strength reads correctly for both directions. */
  spyReturnPct10d: number | null;
  accumAlignedDays: number | null;
  accumTotalDays: number | null;
  /** Direction-ALIGNED stack (for a SHORT these carry the bearish stack, so trendStackScore rewards it). */
  priceAboveEma20?: boolean;
  ema20AboveEma50?: boolean;
  ema50Rising?: boolean;
}

const NO_SWING: SwingSignals = {
  direction: null,
  returnPct10d: null,
  spyReturnPct10d: null,
  accumAlignedDays: null,
  accumTotalDays: null,
};

function directionFromLean(lean: "bull" | "bear" | "neutral" | undefined): PlayDirection | null {
  if (lean === "bull") return "LONG";
  if (lean === "bear") return "SHORT";
  return null; // neutral or unknown → no swing candidate (honest absence, not a coin-flip)
}

/**
 * Build the Swing signal subset from a name's multi-day reads. Returns NO_SWING (direction null → the
 * candidate builder omits the SWING lane) when there's no directional multi-day flow to anchor the trade.
 */
export function swingSignalsFromReads(reads: SwingReads): SwingSignals {
  const direction = directionFromLean(reads.accumulation?.direction);
  if (!direction || !reads.accumulation) return NO_SWING;

  const sign = direction === "LONG" ? 1 : -1;
  const signed = (n: number | null): number | null =>
    n != null && Number.isFinite(n) ? sign * n : null;

  // For a SHORT the bullish stack is INVERTED into the aligned (bearish) stack: price below EMA20, EMA20
  // below EMA50, EMA50 falling all become the "aligned" trues that trendStackScore rewards.
  const align = (bullish: boolean | undefined): boolean | undefined =>
    bullish == null ? undefined : direction === "LONG" ? bullish : !bullish;

  return {
    direction,
    returnPct10d: signed(reads.returnPct10d),
    spyReturnPct10d: signed(reads.spyReturnPct10d),
    accumAlignedDays: Number.isFinite(reads.accumulation.days) ? reads.accumulation.days : null,
    accumTotalDays: reads.flowWindowDays > 0 ? reads.flowWindowDays : null,
    priceAboveEma20: align(reads.priceAboveEma20),
    ema20AboveEma50: align(reads.ema20AboveEma50),
    ema50Rising: align(reads.ema50Rising),
  };
}
