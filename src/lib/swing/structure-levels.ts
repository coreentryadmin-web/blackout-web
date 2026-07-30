/**
 * Underlying-terms plan levels for a Swing thesis (entry / structural invalidation / target).
 *
 * Pure + null-honest: missing price → null plan (never invent a stop). ATR comes from the name's daily
 * closes when available; a thin series falls back to 1.5% of price (a grounded price-relative proxy, not
 * a fabricated absolute level). R:R ≈ 1.8 with 1.5×ATR stop / 2.7×ATR target — matches the evidence-only
 * reward_risk_floor (1.8) in gates.ts.
 */

import type { PlayDirection } from "../horizon-fanout";

export type SwingPlanLevels = {
  entryUnderlyingPx: number;
  thesisInvalidationPx: number;
  targetUnderlyingPx: number;
  atr: number;
};

const isPos = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0;

/** Average absolute close-to-close move over the last `n` sessions — a cheap ATR proxy from closes alone. */
export function atrProxyFromCloses(closes: readonly number[], n = 14): number | null {
  if (!Array.isArray(closes) || closes.length < n + 1) return null;
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const a = closes[i];
    const b = closes[i - 1];
    if (!isPos(a) || !isPos(b)) return null;
    sum += Math.abs(a - b);
  }
  const atr = sum / n;
  return Number.isFinite(atr) && atr > 0 ? atr : null;
}

/**
 * Derive entry / structural-stop / target in underlying terms for the trade direction.
 * Returns null when price is unusable (honest absence — manager keeps structural_stop inert).
 */
export function deriveSwingPlanLevels(
  direction: PlayDirection,
  price: number,
  atrIn: number | null | undefined,
): SwingPlanLevels | null {
  if (!isPos(price)) return null;
  const atr = isPos(atrIn) ? atrIn : price * 0.015;
  const stopDist = 1.5 * atr;
  const targetDist = 2.7 * atr; // ≈ 1.8R vs the 1.5×ATR stop
  if (direction === "LONG") {
    return {
      entryUnderlyingPx: price,
      thesisInvalidationPx: price - stopDist,
      targetUnderlyingPx: price + targetDist,
      atr,
    };
  }
  // SHORT
  return {
    entryUnderlyingPx: price,
    thesisInvalidationPx: price + stopDist,
    targetUnderlyingPx: price - targetDist,
    atr,
  };
}
