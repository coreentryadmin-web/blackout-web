// src/lib/swing/record.ts — roll-chain-aware swing record (PR-14). Pure. Evidence-only.
//
// A swing thesis can be ROLLED: at ~3 DTE the manager closes the leg, FREEZES its grade, and opens a linked
// child further out (close+grade+open-new, never overwrite — PR-15). The chain is therefore a SEQUENCE of
// independently graded legs, threaded by root/parent/roll_seq. This module turns one fetched chain
// (fetchSwingPositionChain, ordered by roll_seq) into a per-leg record + a chain composite.
//
// THE ONE INVARIANT THIS FILE EXISTS TO PROTECT: a roll composite must PRESERVE a parent loss — it must
// NEVER net it away. A tempting composite is "sum the leg P&Ls" or "compound the returns", but a winning
// child can then cancel a losing parent and the chain reads as a win — laundering a real loss out of the
// record (the survivorship failure mode the whole engine is built against). So the composite WIN predicate
// is `allLegsWon` (EVERY graded leg > 0). A single losing leg makes the composite a LOSS regardless of how
// well later legs did. The money views (sum / compounded return) are reported SEPARATELY and can be
// positive on a loss-containing chain — they are never allowed to relabel the outcome. `worstLegPnlPct` is
// carried as the explicit preserved-loss witness.
//
// WIN PREDICATE: realized_pnl_pct > 0 — identical to zerodte record.ts isZeroDteWin and the feature store,
// so all three surfaces agree on what a win is. LOW_N_THRESHOLD is reused from the 0DTE record so a thin
// chain is badged the same way. PURE — the caller does the fetch.

import { LOW_N_THRESHOLD } from "../zerodte/record";

export { LOW_N_THRESHOLD };

/** Methodology label served with any swing record — the honest-record rule (never blend with 0DTE/Slayer). */
export const SWING_RECORD_METHODOLOGY =
  "Swing records grade each roll-chain LEG independently against its own frozen multi-truth grade, then " +
  "form a chain composite that PRESERVES every leg's loss — a winning later leg never nets away a losing " +
  "earlier one (composite win = every graded leg positive). Sum / compounded returns are reported " +
  "separately as the capital view and never relabel the outcome. A win is positive realized plan P&L.";

/** Win = positive realized plan P&L — identical to zerodte record.ts isZeroDteWin + the feature store. */
export function isSwingWin(realizedPnlPct: number | null | undefined): boolean {
  return (realizedPnlPct ?? 0) > 0;
}

/** One roll-chain leg as the record needs it — structurally satisfied by db.ts SwingPositionRow. */
export interface SwingLegRowLike {
  id: number;
  root_position_id: number | null;
  parent_position_id: number | null;
  roll_seq: number;
  ticker: string;
  direction: "long" | "short";
  status: string;
  realized_pnl_pct: number | null;
  graded_at: string | null;
  grade_json: Record<string, unknown> | null;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface SwingLegGrade {
  positionId: number;
  rollSeq: number;
  ticker: string;
  direction: "long" | "short";
  status: string;
  /** Frozen realized P&L for THIS leg (null until the leg is graded). */
  realizedPnlPct: number | null;
  graded: boolean;
  /** isSwingWin(realizedPnlPct) — only meaningful when graded. */
  win: boolean;
  /** The leg's frozen multi-truth grade, passed through untouched (never re-derived). */
  grade: Record<string, unknown> | null;
}

export interface SwingChainComposite {
  rootPositionId: number | null;
  legs: number;
  gradedLegs: number;
  wins: number;
  losses: number;
  /**
   * EVERY graded leg won. This is the composite WIN predicate — a single losing leg makes it false, so a
   * winning child can NEVER net away a losing parent. False when there are 0 graded legs.
   */
  allLegsWon: boolean;
  /** win / loss / open — derived from allLegsWon; a loss-containing chain is a loss even if the money is up. */
  outcome: "win" | "loss" | "open";
  /** The preserved-loss witness: the worst (min) realized leg P&L. Never averaged away. */
  worstLegPnlPct: number | null;
  /** Money view: simple sum of graded-leg realized P&L. Reported, never used to relabel the outcome. */
  sumPnlPct: number | null;
  /** Money view: compounded capital return ∏(1+pnl/100)−1, %. Can be positive on a loss-containing chain. */
  compoundedReturnPct: number | null;
  /** gradedLegs < LOW_N_THRESHOLD — badge it; aggregators must not lean on it. */
  low_n: boolean;
}

export interface SwingRecord {
  methodology: string;
  rootPositionId: number | null;
  legs: SwingLegGrade[];
  composite: SwingChainComposite;
}

/** The root id for a chain: the row whose root_position_id is null is the root; else the shared root ref. */
function rootIdOf(chain: SwingLegRowLike[]): number | null {
  for (const r of chain) {
    if (r.root_position_id == null) return r.id; // the root row references no root
  }
  return chain.find((r) => r.root_position_id != null)?.root_position_id ?? null;
}

/**
 * Build the swing record from ONE roll chain (rows from fetchSwingPositionChain). Legs are re-sorted by
 * roll_seq (then id) defensively so the composite never depends on fetch order. Each leg keeps its own
 * frozen grade; the composite preserves every loss (see the file header — the reason this module exists).
 */
export function buildSwingRecord(chain: SwingLegRowLike[]): SwingRecord {
  const ordered = [...chain].sort((a, b) => a.roll_seq - b.roll_seq || a.id - b.id);

  const legs: SwingLegGrade[] = ordered.map((r) => {
    const graded = r.graded_at != null && finite(r.realized_pnl_pct);
    return {
      positionId: r.id,
      rollSeq: r.roll_seq,
      ticker: r.ticker,
      direction: r.direction,
      status: r.status,
      realizedPnlPct: finite(r.realized_pnl_pct) ? r.realized_pnl_pct : null,
      graded,
      win: graded && isSwingWin(r.realized_pnl_pct),
      grade: r.grade_json,
    };
  });

  const gradedLegs = legs.filter((l) => l.graded);
  const wins = gradedLegs.filter((l) => l.win).length;
  const losses = gradedLegs.length - wins;
  // Composite win = EVERY graded leg won. A single non-winning leg → loss, so a winning child cannot net
  // away a losing parent. This is the whole point of the module.
  const allLegsWon = gradedLegs.length > 0 && gradedLegs.every((l) => l.win);

  const pnls = gradedLegs.map((l) => l.realizedPnlPct!).filter(finite);
  const worstLegPnlPct = pnls.length ? Math.min(...pnls) : null;
  const sumPnlPct = pnls.length ? round2(pnls.reduce((a, b) => a + b, 0)) : null;
  // Compounded capital return — the honest money number. Deliberately SEPARATE from the outcome label:
  // it can be positive while the chain contains a real loss, and it is never allowed to relabel it.
  const compoundedReturnPct = pnls.length
    ? round2((pnls.reduce((acc, p) => acc * (1 + p / 100), 1) - 1) * 100)
    : null;

  const outcome: SwingChainComposite["outcome"] =
    gradedLegs.length === 0 ? "open" : allLegsWon ? "win" : "loss";

  const composite: SwingChainComposite = {
    rootPositionId: rootIdOf(ordered),
    legs: legs.length,
    gradedLegs: gradedLegs.length,
    wins,
    losses,
    allLegsWon,
    outcome,
    worstLegPnlPct,
    sumPnlPct,
    compoundedReturnPct,
    low_n: gradedLegs.length < LOW_N_THRESHOLD,
  };

  return {
    methodology: SWING_RECORD_METHODOLOGY,
    rootPositionId: composite.rootPositionId,
    legs,
    composite,
  };
}
