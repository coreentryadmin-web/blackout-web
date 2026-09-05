/**
 * POSITIONING origin screen (Swing Engine V2 P2) — Thermal GEX + gamma walls.
 *
 * Surfaces tickers where dealer positioning supports a directional swing thesis
 * inside the 4–15 DTE window. P2 wires live getGexPositioning reads; P1 exports
 * pure scoring helpers for unit tests.
 */

import type { GexPositioning } from "@/lib/providers/gex-positioning";

export interface PositioningOriginCandidate {
  ticker: string;
  direction: "LONG" | "SHORT";
  gammaPosture: string | null;
  flipDistancePct: number | null;
  wallStrike: number | null;
  score: number;
  reason: string;
}

/** Pure: score positioning read for swing admission (0–100). */
export function scorePositioningForSwing(gex: GexPositioning | null): PositioningOriginCandidate | null {
  if (!gex || !(gex.spot > 0)) return null;

  const spot = gex.spot;
  const callWall = gex.call_wall;
  const putWall = gex.put_wall;
  const longGamma = gex.gamma_posture === "long" || gex.net_gex > 0;
  const shortGamma = gex.gamma_posture === "short" || gex.net_gex < 0;

  let direction: "LONG" | "SHORT" | null = null;
  let wallStrike: number | null = null;
  let reason = "";

  if (callWall != null && spot < callWall * 0.98 && longGamma) {
    direction = "LONG";
    wallStrike = callWall;
    reason = `long gamma into call wall ${callWall}`;
  } else if (putWall != null && spot > putWall * 1.02 && shortGamma) {
    direction = "SHORT";
    wallStrike = putWall;
    reason = `short gamma below put wall ${putWall}`;
  }

  if (!direction) return null;

  const flipDistancePct = gex.distance_to_flip_pct ?? gex.distance_to_nearest_flip_pct ?? null;

  let score = 55;
  if (Math.abs(gex.net_gex) > 0) score += 10;
  if (flipDistancePct != null && Math.abs(flipDistancePct) < 3) score += 15;

  return {
    ticker: gex.ticker,
    direction,
    gammaPosture: gex.gamma_posture ?? null,
    flipDistancePct,
    wallStrike,
    score: Math.min(100, score),
    reason,
  };
}
