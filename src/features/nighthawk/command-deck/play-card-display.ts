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

/** Label beside the return % on list rows — WATCH uses "Since flag", not "P&L".
 *
 * BUG FIX (round 509 audit): the LEGACY branch used to key off `play.stockMovePct != null`
 * alone to decide between "Stock" and "P&L". `overlayLegacyQuotes` (use-legacy-quotes.ts)
 * stamps `stockMovePct` UNCONDITIONALLY on every Legacy play with a resolvable entry band —
 * and, critically, `containers.tsx` composes the overlays as
 * `overlayLegacyOptionMarks(overlayLegacyQuotes(plays, ...), marks)`, so once a REAL live
 * option mark lands and `overlayLegacyOptionMarks` restores a genuine `pnlPct`, the earlier
 * `stockMovePct` stamp is simply never cleared. So `stockMovePct != null` was true for nearly
 * every OPEN Legacy row, real option P&L included, not only the "no mark yet" case the label
 * was written to distinguish. Meanwhile the actual number this label sits beside
 * (`playListReturnPct` -> `openMetricsValues` -> `legacyPrimaryPnlPct`, play-card-lifecycle.ts)
 * already prefers the real `pnlPct` first — so a Legacy OPEN play with a working live option
 * mark rendered its genuine option premium return under the label "Stock" in the Command
 * Deck's compact list rows (`PlayLifecycleCardBody`, which every lane's list view shares).
 * The sibling call site at CommandDeck.tsx's own card body (~line 872) already gets this right
 * — `p.pnlPct != null ? "Premium" : "Stock"` — by checking which VALUE is actually being shown
 * rather than whether a stock-derived number merely exists alongside it. Mirrored here. */
export function primaryReturnLabel(play: TerminalPlay): string {
  if (isWatchTrackStatus(play.status) && play.trackPct != null) return "Since flag";
  if (play.horizon === "LEGACY") {
    if (play.status === "CLOSED") return "Peak Return";
    return play.pnlPct != null ? "P&L" : "Stock";
  }
  if (play.status === "CLOSED") return "Peak Return";
  return "P&L";
}

// ROUNDS BY MAGNITUDE, THEN REAPPLIES SIGN — plain `Math.round(n)` ties toward +Infinity
// (`Math.round(-2.5) === -2` but `Math.round(2.5) === 3`), a sign-biased asymmetry: a losing
// Peak/Trough/P&L reading (CommandDeck.tsx, PlayLifecycleCard.tsx, TerminalPremiumPanels.tsx)
// sitting exactly on a half-percent tie rendered a SMALLER magnitude than the identical-distance
// gain. Same bug class already fixed in fmt-money.ts's fmtPct, round-floats.ts,
// thermal/gex-heatmap/shift-math.ts's fmtShiftPercentForStrike, and this very command-deck's own
// PlayTerminal.tsx/ZeroDteCommandPanel.tsx signPct helpers — this was an independent,
// un-migrated paste of the same formatter.
export function formatReturnPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Math.sign(n) * Math.round(Math.abs(n));
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
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
