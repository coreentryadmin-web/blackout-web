import type { TerminalPlay } from "./types";
import { tierRank } from "./deck-sort";

/** Quality / confidence % for the row — score is 0–100 on 0DTE; confidence is 0–1 when wired. */
export function playQualityPct(play: TerminalPlay): number | null {
  if (play.confidence != null && Number.isFinite(play.confidence)) {
    const pct = play.confidence <= 1 ? play.confidence * 100 : play.confidence;
    return Math.round(Math.max(0, Math.min(100, pct)));
  }
  if (play.score != null && Number.isFinite(play.score) && play.score > 0) {
    return Math.round(Math.max(0, Math.min(100, play.score)));
  }
  return null;
}

/** Letter grade for display — tier label first, never fabricated. */
export function playGradeLabel(play: TerminalPlay): string | null {
  const t = play.tierLabel?.trim();
  return t || null;
}

/** 1–5 star count from merit tier (A+ → 5, F → 0). */
export function tierStarCount(tier: string | null | undefined): number {
  const r = tierRank(tier);
  if (r <= 0) return 0;
  return Math.max(1, Math.min(5, Math.round(r)));
}

export function tierStars(tier: string | null | undefined): string {
  const n = tierStarCount(tier);
  if (n === 0) return "";
  return "★".repeat(n) + "☆".repeat(5 - n);
}

/** Primary return number for the row — peak when closed, live P&L otherwise. */
export function primaryReturnPct(play: TerminalPlay): number | null {
  if (play.status === "CLOSED" && play.peak != null) return play.peak;
  if (play.pnlPct != null && play.pnlPct !== 0) return play.pnlPct;
  if (play.status === "CLOSED" && play.pnlPct != null) return play.pnlPct;
  return null;
}

export function formatReturnPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${Math.round(n)}%`;
}

/** First discovery origin label for the row chip. */
export function originChip(play: TerminalPlay): string | null {
  const o = play.discoveryOrigin?.[0];
  if (!o) return null;
  return o.replace(/_/g, " ");
}

/** Hero treatment: the selected 0DTE row expands into the primary card. */
export function useHeroPlayCard(play: TerminalPlay, selected: boolean, _rank: number): boolean {
  return play.horizon === "ZERO_DTE" && selected;
}

/** Enhanced 0DTE row (grade + quality visible) — all 0DTE rows, not Legacy/Swing. */
export function useEnhancedZeroDteRow(play: TerminalPlay): boolean {
  return play.horizon === "ZERO_DTE";
}
