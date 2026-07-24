// src/lib/swing/portfolio.ts — pure portfolio-OVERLAP detection for the swing gate (PR-5).
//
// The one thing the gate needs from the book today is: "does this candidate double a bet I already hold, or
// fight it?" This module answers exactly that and NOTHING more — the full allocation math (risk budgets,
// cluster caps, sizing) is PR-6. Deliberately scoped to overlap DETECTION so the gate has an evidence signal
// without pulling the allocation engine forward.
//
// Overlap is resolved through the ONE theme resolver (theme-cluster.ts, SEV-9), so "same thesis" here means the
// SAME partition the allocator will later cap — NVDA long + QQQ long is flagged as one semis bet, not two. Two
// flavors, both surfaced (the gate treats them as evidence, never a hard block):
//   • same-theme SAME-direction  ⇒ CONCENTRATION (stacking the identical wager).
//   • same-theme OPPOSED-direction ⇒ INTERNAL CONFLICT (one leg is guaranteed to fight the other).
//
// PURE & deterministic — no IO. Evidence-only: flags overlap; sizes and blocks nothing.

import type { PlayDirection } from "../horizon-fanout";
import { resolveTheme, sameThesis } from "./theme-cluster";

/** A held (or candidate) position — the minimum the overlap check needs. */
export interface PortfolioPosition {
  ticker: string;
  direction: PlayDirection;
}

export interface PortfolioOverlap {
  /** True when at least one existing position shares the candidate's theme. */
  hasOverlap: boolean;
  /** The candidate's resolved theme cluster. */
  theme: string;
  /** Existing positions in the same theme AND same direction (concentration). */
  sameThemeSameDirection: PortfolioPosition[];
  /** Existing positions in the same theme but OPPOSED direction (internal conflict). */
  sameThemeOpposedDirection: PortfolioPosition[];
  reason: string;
}

/**
 * Detect theme/direction overlap between a candidate and the existing book. Self-matches (same ticker AND
 * same direction as the candidate) are excluded — a position doesn't overlap itself. Empty `existing` is a
 * valid, common case (returns no overlap). Pure.
 */
export function checkPortfolioOverlap(
  candidate: PortfolioPosition,
  existing: PortfolioPosition[] = [],
): PortfolioOverlap {
  const theme = resolveTheme(candidate.ticker);
  const candTicker = candidate.ticker.trim().toUpperCase();

  const sameDir: PortfolioPosition[] = [];
  const opposedDir: PortfolioPosition[] = [];

  for (const pos of existing) {
    // Skip the candidate's own identical position (same ticker + same direction).
    if (pos.ticker.trim().toUpperCase() === candTicker && pos.direction === candidate.direction) continue;
    if (!sameThesis(candidate.ticker, pos.ticker)) continue;
    if (pos.direction === candidate.direction) sameDir.push(pos);
    else opposedDir.push(pos);
  }

  const hasOverlap = sameDir.length > 0 || opposedDir.length > 0;
  return {
    hasOverlap,
    theme,
    sameThemeSameDirection: sameDir,
    sameThemeOpposedDirection: opposedDir,
    reason: hasOverlap
      ? `Theme "${theme}" overlap: ${sameDir.length} same-direction (concentration), ` +
        `${opposedDir.length} opposed (internal conflict).`
      : `No book overlap in theme "${theme}".`,
  };
}
