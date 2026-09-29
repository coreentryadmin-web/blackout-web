import type { TerminalPlay } from "./types";
import { tierRank } from "./deck-sort";
import { isWatchTrackStatus } from "./play-card-lifecycle";

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

/**
 * Letter grade for display — tier label only.
 *
 * SWING/LEAPS used to fall back to `convictionFromScore(play.score)` when no `tierLabel` was
 * pinned — the exact score->letter mapping `nighthawk-tiers.ts`'s own header documents as
 * empirically INVERTED for the overnight product it was calibrated on (A+ scored worst, B
 * scored best), never validated for swing's own differently-shaped score distribution (which
 * this lane's own `swing-score-calibration.mjs` separately found is ALSO not a reliable outcome
 * ranker). The adapter (`terminalPlayFromHorizon`) now honestly leaves `tierLabel` null for
 * SWING/LEAPS instead of pre-computing that mapping — but this fallback would have silently
 * re-derived the identical bad grade right back at render time, undoing that fix. Removed
 * rather than gated: there is no swing-calibrated tier engine to fall back TO yet.
 */
export function playGradeLabel(play: TerminalPlay): string | null {
  const t = play.tierLabel?.trim();
  return t || null;
}

/** Entry premium in the GRADE column — 0DTE/Legacy only; swings show letter grade, entry lives in the rail. */
export function playEntryInGradeColumn(play: TerminalPlay): boolean {
  return play.horizon === "ZERO_DTE" || play.horizon === "LEGACY";
}

/** Entry premium (0DTE per-contract, or condor net credit) for the list row — compact $ form.
 *  Null when the play carries no entry field rather than showing a fabricated $0.00. */
export function playEntryDisplay(play: TerminalPlay): string | null {
  if (play.horizon === "LEGACY") {
    if (play.entryCostPerContract != null && Number.isFinite(play.entryCostPerContract)) {
      return `$${play.entryCostPerContract.toFixed(2)}/sh`;
    }
    if (play.entryRange) return play.entryRange;
  }
  if (play.entry == null || !Number.isFinite(play.entry)) return null;
  return `$${play.entry.toFixed(2)}`;
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

/** Primary return number for the row — peak when closed, live P&L when open, track when WATCH. */
export function primaryReturnPct(play: TerminalPlay): number | null {
  if (play.status === "CLOSED" && play.peak != null) return play.peak;
  if (isWatchTrackStatus(play.status) && play.trackPct != null && Number.isFinite(play.trackPct)) {
    return play.trackPct;
  }
  if (play.pnlPct != null && play.pnlPct !== 0) return play.pnlPct;
  if (play.status === "CLOSED" && play.pnlPct != null) return play.pnlPct;
  return null;
}

/** Label beside the return % on list rows — WATCH uses "Since flag", not "P&L". */
export function primaryReturnLabel(play: TerminalPlay): string {
  if (isWatchTrackStatus(play.status) && play.trackPct != null) return "Since flag";
  if (play.horizon === "LEGACY") {
    if (play.status === "CLOSED") return "Peak Return";
    return play.stockMovePct != null ? "Stock" : "P&L";
  }
  if (play.status === "CLOSED") return "Peak Return";
  return "P&L";
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

/** Hero treatment: detail lives on the right rail — list rows stay compact. */
export function useHeroPlayCard(_play: TerminalPlay, _selected: boolean, _rank: number): boolean {
  return false;
}

/** Lifecycle card layout — all four Night Hawk lanes. */
export function useLifecyclePlayCard(_play: TerminalPlay): boolean {
  return true;
}
