import type { EarningsFlag, NewsHeat } from "../../board";
import type { RailHit } from "../types";

export type CatalystRailInput = {
  ticker: string;
  direction: "long" | "short";
  catalyst_flags?: string[];
  news_hot?: NewsHeat | null;
  earnings?: EarningsFlag | null;
  expected_move_pct?: number | null;
};

export function scoreCatalystRail(input: CatalystRailInput): RailHit | null {
  const flags = input.catalyst_flags ?? [];
  const news = input.news_hot;
  const earnings = input.earnings;
  const em =
    input.expected_move_pct ?? earnings?.expected_move_pct ?? null;

  let score = 40;
  const parts: string[] = [];

  if (flags.length > 0) {
    score += Math.min(25, flags.length * 8);
    parts.push(flags.slice(0, 2).join(", "));
  }

  if (news && news.minutes_ago <= 120) {
    score += news.minutes_ago <= 30 ? 18 : 10;
    parts.push(`headline ${news.minutes_ago}m`);
  }

  if (earnings?.report_date) {
    score += 15;
    parts.push(`earnings ${earnings.when}`);
  }

  if (em != null && Number.isFinite(em) && em >= 4) {
    score += Math.min(12, Math.round(em));
    parts.push(`EM ±${em.toFixed(1)}%`);
  }

  score = Math.min(100, Math.round(score));
  if (score < 55 && parts.length === 0) return null;

  return {
    rail: "CATALYST",
    ticker: input.ticker.toUpperCase(),
    direction: input.direction,
    score,
    summary: parts.length ? parts.join(" · ") : "catalyst lane",
    meta: { flag_count: flags.length },
  };
}
