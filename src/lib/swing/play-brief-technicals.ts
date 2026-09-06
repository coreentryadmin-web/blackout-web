import type { VectorFullState } from "@/lib/bie/vector-full-state";

/**
 * Majority-vote bias FROM the technicals themselves (EMA stack, MACD, VWAP side, market structure) —
 * never from the play's own LONG/SHORT direction, which carries zero information about what the
 * chart currently reads (FINDINGS 2026-09-06: a SHORT play with an entirely bullish tape, or a LONG
 * play with an entirely bearish one, both rendered a badge that echoed the position instead of the
 * evidence). Ties or no readable signals fall back to neutral — an absent verdict is honest, a wrong
 * one is not.
 */
export function technicalsBias(
  t: NonNullable<VectorFullState["technicals"]>,
  spot: number | null,
): "bullish" | "bearish" | "neutral" {
  let bull = 0;
  let bear = 0;
  if (t.emaStack === "up") bull++;
  else if (t.emaStack === "down") bear++;
  if (t.macd === "bull") bull++;
  else if (t.macd === "bear") bear++;
  if (spot != null && t.vwap != null) {
    if (spot >= t.vwap) bull++;
    else bear++;
  }
  if (t.structure?.direction === "up") bull++;
  else if (t.structure?.direction === "down") bear++;
  if (bull > bear) return "bullish";
  if (bear > bull) return "bearish";
  return "neutral";
}
