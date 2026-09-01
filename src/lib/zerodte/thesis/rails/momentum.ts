import type { IntradayRead } from "../../intraday";
import type { RailHit } from "../types";

export type MomentumRailInput = {
  ticker: string;
  direction: "long" | "short";
  rel_vol?: number | null;
  intraday?: IntradayRead | null;
  change_pct?: number | null;
};

export function scoreMomentumRail(input: MomentumRailInput): RailHit | null {
  const { ticker, direction, rel_vol, intraday, change_pct } = input;
  let score = 40;
  const parts: string[] = [];

  if (rel_vol != null && rel_vol >= 1.5) {
    score += Math.min(25, (rel_vol - 1) * 12);
    parts.push(`RVOL ${rel_vol.toFixed(1)}×`);
  }
  if (intraday?.trend_5m === "up" && direction === "long") {
    score += 12;
    parts.push("5m up");
  } else if (intraday?.trend_5m === "down" && direction === "short") {
    score += 12;
    parts.push("5m down");
  }
  if (intraday?.vwap_dist_pct != null) {
    const aligned =
      (direction === "long" && intraday.vwap_dist_pct > 0) ||
      (direction === "short" && intraday.vwap_dist_pct < 0);
    if (aligned) {
      score += 10;
      parts.push("VWAP hold");
    }
  }
  if (change_pct != null && Math.abs(change_pct) >= 1) {
    score += Math.min(10, Math.abs(change_pct) * 3);
  }

  score = Math.min(100, Math.round(score));
  if (score < 52) return null;

  return {
    rail: "MOMENTUM",
    ticker: ticker.toUpperCase(),
    direction,
    score,
    summary: parts.length ? parts.join(" · ") : "intraday momentum",
  };
}
