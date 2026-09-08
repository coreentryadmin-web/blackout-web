/**
 * 0DTE Command Deck — left-rail command center stats (pure, display-only).
 * Every value is grounded in the live board or the fetched 30d record — never fabricated.
 */

import { sortPlaysByConviction, tierRank } from "./deck-sort";
import { playGradeLabel } from "./play-card-display";
import type { TerminalPlay } from "./types";

export type ConvictionRankContext = {
  rank: number;
  total: number;
  /** True when this play is #1 by engine conviction on today's full board. */
  isHighestToday: boolean;
};

/** Conviction rank on the full opportunity set — grounded in sortPlaysByConviction. */
export function convictionRankContext(
  allPlays: TerminalPlay[],
  playId: string,
): ConvictionRankContext | null {
  if (allPlays.length === 0) return null;
  const sorted = sortPlaysByConviction(allPlays);
  const idx = sorted.findIndex((p) => p.id === playId);
  if (idx < 0) return null;
  return {
    rank: idx + 1,
    total: allPlays.length,
    isHighestToday: idx === 0,
  };
}

export type TodaysEdgeLevel = "High" | "Medium" | "Low";

export type DeckCommandCenterStats = {
  /** Total plays on today's board. */
  opportunities: number;
  /** Fresh candidates scanned this cycle (WATCH + SKIP, not committed). */
  scanned: number;
  /** Working + closed committed ledger rows. */
  committed: number;
  /** Gate-clearing fresh finds not yet in ledger. */
  commitReady: number;
  /** Gate-blocked fresh finds. */
  gateBlocked: number;
  /** Highest-conviction play ticker + letter grade, when the board carries tier evidence. */
  topRated: { ticker: string; grade: string } | null;
  /** Session edge from today's play quality — null when the board is empty. */
  edge: TodaysEdgeLevel | null;
};

/** Best play by engine conviction (tier × confluence × tape), not the active filter sort. */
export function topRatedPlay(plays: TerminalPlay[]): { ticker: string; grade: string } | null {
  if (plays.length === 0) return null;
  const best = sortPlaysByConviction(plays)[0];
  if (!best) return null;
  const grade = playGradeLabel(best);
  if (!grade) return null;
  return { ticker: best.ticker, grade };
}

/**
 * Qualitative edge from today's opportunity set — tier quality + breadth, not a fabricated score.
 * High: A+ leadership or multiple A-tier names; Medium: at least one A or a deep board; Low: thin/weak.
 */
export function deriveTodaysEdge(plays: TerminalPlay[]): TodaysEdgeLevel | null {
  if (plays.length === 0) return null;
  const aPlus = plays.filter((p) => tierRank(p.tierLabel) >= 5.5).length;
  const aTier = plays.filter((p) => tierRank(p.tierLabel) >= 5).length;
  if (aPlus >= 1 || aTier >= 3) return "High";
  if (aTier >= 1 || plays.length >= 6) return "Medium";
  return "Low";
}

export function buildDeckCommandCenterStats(plays: TerminalPlay[]): DeckCommandCenterStats {
  let scanned = 0;
  let committed = 0;
  let commitReady = 0;
  let gateBlocked = 0;
  for (const p of plays) {
    if (p.status === "WATCH") {
      scanned += 1;
      commitReady += 1;
    } else if (p.status === "SKIP") {
      scanned += 1;
      gateBlocked += 1;
    } else if (p.status === "OPEN" || p.status === "HOLD" || p.status === "TRIM" || p.status === "CLOSED") {
      committed += 1;
    }
  }
  return {
    opportunities: plays.length,
    scanned,
    committed,
    commitReady,
    gateBlocked,
    topRated: topRatedPlay(plays),
    edge: deriveTodaysEdge(plays),
  };
}
