import type { IntradayRead } from "../../intraday";
import type { RailHit, StructuralState } from "../types";

export type BreakoutRailInput = {
  ticker: string;
  direction: "long" | "short";
  spot: number;
  /** Prior session high (PDH) or resistance. */
  resistance?: number | null;
  /** Prior session low (PDL) or support. */
  support?: number | null;
  rel_vol?: number | null;
  intraday?: IntradayRead | null;
  /** Legacy breakout score from gain screen (0–100). */
  legacy_score?: number;
};

export function detectStructuralState(input: BreakoutRailInput): StructuralState {
  const { spot, resistance, support, direction, intraday } = input;
  const tol = 0.0015;
  if (direction === "long" && resistance != null && resistance > 0) {
    const dist = (resistance - spot) / resistance;
    if (dist <= 0) return "TRIGGERED";
    if (dist <= tol * 3) return "COILED";
  }
  if (direction === "short" && support != null && support > 0) {
    const dist = (spot - support) / support;
    if (dist <= 0) return "TRIGGERED";
    if (dist <= tol * 3) return "COILED";
  }
  if (intraday?.or_break === "above" && direction === "long") return "TRIGGERED";
  if (intraday?.or_break === "below" && direction === "short") return "TRIGGERED";
  return null;
}

export function scoreBreakoutRail(input: BreakoutRailInput): RailHit | null {
  const structural_state = detectStructuralState(input);
  let score = input.legacy_score ?? 50;
  const parts: string[] = [];

  if (structural_state === "COILED") {
    score = Math.max(score, 72);
    parts.push("COILED");
    if (input.resistance != null) parts.push(`trigger ${input.resistance.toFixed(2)}`);
    else if (input.support != null) parts.push(`trigger ${input.support.toFixed(2)}`);
  } else if (structural_state === "TRIGGERED") {
    score = Math.max(score, 78);
    parts.push("TRIGGERED");
  }

  if (input.rel_vol != null && input.rel_vol >= 2) {
    score += 6;
    parts.push(`RVOL ${input.rel_vol.toFixed(1)}×`);
  }

  score = Math.min(100, Math.round(score));
  if (score < 52 && !structural_state) return null;

  const trigger =
    input.direction === "long" ? input.resistance ?? null : input.support ?? null;

  return {
    rail: "BREAKOUT",
    ticker: input.ticker.toUpperCase(),
    direction: input.direction,
    score,
    structural_state,
    summary: parts.join(" · ") || "structural breakout",
    meta: { trigger_price: trigger },
  };
}
