import type { RailHit } from "../types";

export type RsRailInput = {
  ticker: string;
  direction: "long" | "short";
  /** Session return % for the ticker. */
  stock_session_pct: number | null;
  /** Session return % for QQQ (or market proxy). */
  qqq_session_pct: number | null;
  /** Session return % for sector ETF (SOXX, XLK, …). */
  sector_session_pct: number | null;
  /** 10d relative return vs sector (stock - peer), optional. */
  d10_alpha?: number | null;
};

export function computeSessionAlpha(stock: number | null, peer: number | null): number | null {
  if (stock == null || peer == null || !Number.isFinite(stock) || !Number.isFinite(peer)) return null;
  return Number((stock - peer).toFixed(2));
}

export function scoreRsRail(input: RsRailInput): RailHit | null {
  const alphaQ = computeSessionAlpha(input.stock_session_pct, input.qqq_session_pct);
  const alphaS = computeSessionAlpha(input.stock_session_pct, input.sector_session_pct);

  let score = 45;
  const parts: string[] = [];

  const primaryAlpha = alphaS ?? alphaQ;
  if (primaryAlpha != null) {
    const aligned =
      (input.direction === "long" && primaryAlpha > 0) || (input.direction === "short" && primaryAlpha < 0);
    if (aligned) {
      score += Math.min(30, Math.abs(primaryAlpha) * 15);
      parts.push(`α ${primaryAlpha >= 0 ? "+" : ""}${primaryAlpha.toFixed(1)}% vs sector`);
    } else if (Math.abs(primaryAlpha) >= 0.5) {
      return null;
    }
  }

  if (input.d10_alpha != null) {
    const d10Aligned =
      (input.direction === "long" && input.d10_alpha > 0) ||
      (input.direction === "short" && input.d10_alpha < 0);
    if (d10Aligned) {
      score += Math.min(15, Math.abs(input.d10_alpha) * 5);
      parts.push(`10d RS ${input.d10_alpha >= 0 ? "+" : ""}${input.d10_alpha.toFixed(1)}%`);
    }
  }

  score = Math.min(100, Math.round(score));
  if (score < 55) return null;

  return {
    rail: "RS",
    ticker: input.ticker.toUpperCase(),
    direction: input.direction,
    score,
    summary: parts.join(" · ") || "relative strength",
    meta: {
      alpha_qqq: alphaQ,
      alpha_sector: alphaS,
    },
  };
}
