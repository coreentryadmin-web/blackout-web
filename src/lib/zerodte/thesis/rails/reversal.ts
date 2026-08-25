import type { IntradayRead } from "../../intraday";
import type { RailHit } from "../types";

export type ReversalRailInput = {
  ticker: string;
  direction: "long" | "short";
  rsi14?: number | null;
  intraday?: IntradayRead | null;
  /** Flow put aggression decelerating + call accumulation (0–1). */
  flow_divergence_score?: number | null;
  put_wall_distance_pct?: number | null;
};

function vwapSigmaApprox(intraday: IntradayRead | null | undefined): number | null {
  if (intraday?.vwap_dist_pct == null || intraday.vwap == null || intraday.last == null) return null;
  const dist = intraday.vwap_dist_pct;
  const dayRange = intraday.day_high != null && intraday.day_low != null ? intraday.day_high - intraday.day_low : null;
  if (dayRange == null || dayRange <= 0 || intraday.vwap <= 0) return Math.abs(dist) / 0.5;
  const sigmaPct = (dayRange / intraday.vwap) * 50;
  if (sigmaPct <= 0) return null;
  return Math.abs(dist) / sigmaPct;
}

export function scoreReversalRail(input: ReversalRailInput): RailHit | null {
  let score = 42;
  const parts: string[] = [];

  const sigma = vwapSigmaApprox(input.intraday);
  if (sigma != null && sigma >= 1.5) {
    score += Math.min(20, (sigma - 1) * 10);
    parts.push(`${sigma.toFixed(1)}σ vs VWAP`);
  }

  if (input.rsi14 != null) {
    if (input.direction === "long" && input.rsi14 <= 32) {
      score += 15;
      parts.push(`RSI ${input.rsi14.toFixed(0)} oversold`);
    } else if (input.direction === "short" && input.rsi14 >= 68) {
      score += 15;
      parts.push(`RSI ${input.rsi14.toFixed(0)} overbought`);
    }
  }

  if (input.flow_divergence_score != null && input.flow_divergence_score >= 0.5) {
    score += 12;
    parts.push("flow divergence");
  }

  if (input.put_wall_distance_pct != null && input.put_wall_distance_pct <= 1.5 && input.direction === "long") {
    score += 10;
    parts.push("put wall support");
  }

  score = Math.min(100, Math.round(score));
  if (score < 58) return null;

  return {
    rail: "REVERSAL",
    ticker: input.ticker.toUpperCase(),
    direction: input.direction,
    score,
    summary: parts.join(" · ") || "mean reversion setup",
  };
}
