/**
 * Dynamic Tier-1 enrichment cap for Swing Engine V2.
 *
 * Mirrors zerodte/breakout-cap.ts: size the budget to the day's merged pool breadth
 * instead of a fixed slice(0, 40) that silently drops recall.
 */

import {
  isSwingEngineV2Enabled,
  swingTier1CapCeiling,
  swingTier1CapFloor,
  swingTier1CapPoolPct,
} from "./config";

export interface SwingTier1CapResolution {
  cap: number;
  mergedCount: number;
  dynamic: boolean;
  floor: number;
  ceiling: number;
  poolPct: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Resolve how many merged Tier-0 seeds may enter Tier-1 enrich this scan.
 * Legacy (V2 off): returns `legacyCap` unchanged (default 40).
 */
export function resolveSwingTier1Cap(
  mergedCount: number,
  legacyCap = 40,
  env: Record<string, string | undefined> = process.env,
): SwingTier1CapResolution {
  const floor = swingTier1CapFloor(env);
  const ceiling = swingTier1CapCeiling(env);
  const poolPct = swingTier1CapPoolPct(env);

  if (!isSwingEngineV2Enabled(env) || mergedCount <= 0) {
    return {
      cap: legacyCap,
      mergedCount,
      dynamic: false,
      floor,
      ceiling,
      poolPct,
    };
  }

  const raw = Math.ceil(mergedCount * poolPct);
  const cap = clamp(raw, floor, ceiling);

  return {
    cap,
    mergedCount,
    dynamic: true,
    floor,
    ceiling,
    poolPct,
  };
}
