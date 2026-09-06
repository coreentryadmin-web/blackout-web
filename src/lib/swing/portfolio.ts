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
  /** Ledger row id when known — lets play-brief exclude the reviewed position by identity. */
  positionId?: number;
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
 * Detect theme/direction overlap between a candidate and the existing book. Self-match exclusion
 * (same ticker AND same direction as the candidate) removes only the FIRST such row — a position
 * doesn't overlap itself, and every caller today (the play-brief's open book, the entry gate's
 * `ctx.existingPositions`) is expected to carry at most that one "this is me" record. Empty
 * `existing` is a valid, common case (returns no overlap). Pure.
 *
 * CORRECTNESS NOTE (2026-09-06, SWING-SYSTEM-CTO-AUDIT finding #10): commit.ts's own design
 * permits MULTIPLE independent open positions on the same ticker+direction —
 * `swingThesisKey(ticker, direction, archetype)` treats a different archetype on the same
 * name+side as a different thesis (commit.ts:310-313) — so a SECOND (or later) row sharing the
 * candidate's ticker+direction is a genuinely separate position, not another copy of "self", and
 * must be counted as concentration. The prior version excluded EVERY row matching ticker+direction
 * (not just the first), which silently hid exactly the most extreme concentration case this
 * function exists to catch: two independently-opened bets on the same name in the same direction
 * (e.g. two EWZ LONG positions under different archetypes) — see the finding for the live
 * `record.json` evidence (EWZ rootPositionId 29 & 26, WULF rootPositionId 17 & 13, both pairs
 * same-direction). `PortfolioPosition` intentionally carries no identity field (ticker+direction
 * is the whole shape) — excluding only the first match is the minimal fix that does not require
 * plumbing a position id through every caller; a caller whose candidate is NOT itself present in
 * `existing` (e.g. a not-yet-committed gate candidate) loses nothing it had before under this
 * change, and gains correct detection whenever a SECOND matching row exists.
 */
export type PortfolioOverlapOptions = {
  /**
   * When set, skip the existing row with this ledger id — the play-brief's precise self-exclusion
   * when multiple independent positions share ticker+direction (different archetypes). Preferred
   * over ticker+direction first-match when `openBook` rows carry `positionId`.
   */
  excludePositionId?: number;
  /**
   * When true (default), skip the first existing row that matches the candidate's ticker+direction
   * as "self" — fallback when no `excludePositionId` is available. Gate callers evaluating an
   * uncommitted dossier should pass false so a lone pre-existing same-ticker/same-direction row
   * is counted as concentration.
   */
  excludeSelfMatch?: boolean;
};

export function checkPortfolioOverlap(
  candidate: PortfolioPosition,
  existing: PortfolioPosition[] = [],
  options: PortfolioOverlapOptions = {},
): PortfolioOverlap {
  const excludeSelfMatch = options.excludeSelfMatch ?? true;
  const excludePositionId = options.excludePositionId;
  const theme = resolveTheme(candidate.ticker);
  const candTicker = candidate.ticker.trim().toUpperCase();

  const sameDir: PortfolioPosition[] = [];
  const opposedDir: PortfolioPosition[] = [];

  // Skip only the FIRST row that looks like "the candidate's own identical position" (same
  // ticker + same direction) — not every such row. See the correctness note above. When the
  // reviewed play's ledger id is known, exclude THAT row by id instead — otherwise a second
  // independent EWZ LONG in the book gets mis-counted as overlap against itself.
  let selfExcluded = false;
  for (const pos of existing) {
    if (excludePositionId != null && pos.positionId === excludePositionId) continue;
    if (
      excludePositionId == null &&
      excludeSelfMatch &&
      !selfExcluded &&
      pos.ticker.trim().toUpperCase() === candTicker &&
      pos.direction === candidate.direction
    ) {
      selfExcluded = true;
      continue;
    }
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
