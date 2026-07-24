// src/lib/swing/swing-board-allocation.ts — wire the advisory swing allocator to the live board (PR-6).
//
// swing-allocation.ts is pure math over abstract candidates; this maps the board's scored swing setups + the
// ledger's open swing positions into it (mirrors portfolio/board-allocation.ts), so the served swing board can
// carry a rank + theme-aggregate + expiry-week decision per name. Loosely typed on input (structural) to stay
// out of the board's provider load graph, and casing is converted at the boundary (board uses lowercase
// long/short; the allocator/PlayDirection use LONG/SHORT).
//
// ADVISORY: the decision rides ALONGSIDE each setup; it does not gate the engine or resize a real position
// (swing-allocation returns `enforce:false`). The portfolio backtest graduates the caps first (PR-16). PURE.

import type { PlayDirection } from "../horizon-fanout";
import {
  allocateSwingBook,
  DEFAULT_SWING_CAPS,
  type ExistingSwingPosition,
  type SwingAllocationCandidate,
  type SwingAllocationDecision,
  type SwingAllocationResult,
  type SwingCaps,
} from "./swing-allocation";

/** Minimal shape of a scored swing board setup this adapter reads. */
export interface SwingBoardSetup {
  ticker: string;
  direction: "long" | "short";
  score: number;
  /** Calibrated EV in R when the store can price it (null today). */
  ev?: number | null;
  /** Option expiry `YYYY-MM-DD` — feeds the same-week-expiry cluster cap. */
  expiry?: string | null;
}

/** Minimal shape of an open ledger swing position (status OPEN/HOLD/TRIM). */
export interface OpenSwingPositionLike {
  ticker: string;
  direction: "long" | "short";
  expiry?: string | null;
  weightPct?: number | null;
}

const dir = (d: "long" | "short"): PlayDirection => (d === "long" ? "LONG" : "SHORT");

/**
 * Allocate today's scored swing setups against the currently-open swing book. Returns the ordered advisory
 * decisions plus a ticker→decision map for attaching onto each setup in the payload.
 */
export function allocateSwingBoard(
  setups: SwingBoardSetup[],
  openPositions: OpenSwingPositionLike[] = [],
  caps: SwingCaps = DEFAULT_SWING_CAPS,
): { decisions: SwingAllocationDecision[]; byTicker: Map<string, SwingAllocationDecision>; result: SwingAllocationResult } {
  const candidates: SwingAllocationCandidate[] = setups.map((s) => ({
    ticker: s.ticker,
    direction: dir(s.direction),
    score: s.score,
    ev: s.ev ?? null,
    expiry: s.expiry ?? null,
  }));
  const existing: ExistingSwingPosition[] = openPositions.map((p) => ({
    ticker: p.ticker,
    direction: dir(p.direction),
    expiry: p.expiry ?? null,
    weightPct: p.weightPct ?? null,
  }));

  const result = allocateSwingBook(candidates, existing, caps);
  const byTicker = new Map<string, SwingAllocationDecision>();
  for (const d of result.decisions) byTicker.set(d.ticker.toUpperCase(), d);
  return { decisions: result.decisions, byTicker, result };
}

/** Open swing positions from ledger rows — only the working states seed the running aggregates. */
export function openSwingPositionsFromLedger(
  rows: Array<{ ticker: string; direction: "long" | "short"; status?: string | null; expiry?: string | null; weightPct?: number | null }>,
): OpenSwingPositionLike[] {
  const OPEN = new Set(["OPEN", "HOLD", "TRIM"]);
  return rows
    .filter((r) => r.status != null && OPEN.has(r.status.toUpperCase()))
    .map((r) => ({ ticker: r.ticker, direction: r.direction, expiry: r.expiry ?? null, weightPct: r.weightPct ?? null }));
}
