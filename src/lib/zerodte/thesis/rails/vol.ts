import type { RailHit } from "../types";

export type VolRailInput = {
  ticker: string;
  direction: "long" | "short";
  rel_volume?: number | null;
  gamma_regime?: string | null;
  rsi14?: number | null;
  /** Optional IV rank 0–100 when available from dossier. */
  iv_rank?: number | null;
};

export function scoreVolRail(input: VolRailInput): RailHit | null {
  let score = 45;
  const parts: string[] = [];

  const rvol = input.rel_volume;
  if (rvol != null && rvol >= 1.5) {
    score += Math.min(20, (rvol - 1) * 10);
    parts.push(`RVOL ${rvol.toFixed(1)}×`);
  }

  const regime = input.gamma_regime ?? "";
  if (regime.includes("short")) {
    score += 8;
    parts.push("short γ");
  } else if (regime.includes("long")) {
    score += 4;
    parts.push("long γ");
  }

  if (input.iv_rank != null && input.iv_rank >= 70) {
    score += 10;
    parts.push(`IV rank ${Math.round(input.iv_rank)}`);
  }

  const rsi = input.rsi14;
  if (rsi != null) {
    if (input.direction === "long" && rsi >= 55 && rsi <= 72) score += 6;
    if (input.direction === "short" && rsi <= 45 && rsi >= 28) score += 6;
  }

  score = Math.min(100, Math.round(score));
  if (score < 52) return null;

  return {
    rail: "VOL",
    ticker: input.ticker.toUpperCase(),
    direction: input.direction,
    score,
    summary: parts.length ? parts.join(" · ") : "vol expansion read",
  };
}
