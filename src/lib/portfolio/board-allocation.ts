/**
 * Wire the Allocation Engine to the LIVE 0DTE board (design-review wiring).
 *
 * allocation.ts is pure math over abstract candidates; this maps the board's real setups + the ledger's open
 * positions into it, so the served board carries a rank + duplicate-thesis + opportunity-cost decision per
 * name. Loosely typed on input (structural) to stay out of board.ts's provider load graph.
 *
 * ADVISORY: the decision rides ALONGSIDE each setup; it does not gate the engine or resize a real position
 * yet — the portfolio backtest graduates it first (see allocation.ts's path-dependence note). PURE.
 */

import { allocate, DEFAULT_ALLOCATION, type AllocationDecision, type AllocationConfig, type Direction } from "./allocation";
import { sectorFor } from "./sector-map";

/** Minimal shape of a scored board setup this adapter reads. */
export interface BoardSetupLike {
  ticker: string;
  direction: "long" | "short";
  score: number;
  /** Calibrated EV in R when the feature store can price it (null today). */
  ev?: number | null;
}

/** Minimal shape of an open ledger position (status OPEN/HOLD/TRIM). */
export interface OpenPositionLike {
  ticker: string;
  direction: "long" | "short";
}

const dir = (d: "long" | "short"): Direction => (d === "long" ? "LONG" : "SHORT");

/**
 * Allocate today's scored setups against the currently-open book. Returns the ordered decisions plus a
 * ticker→decision map for attaching onto each setup in the payload.
 */
export function allocateBoard(
  setups: BoardSetupLike[],
  openPositions: OpenPositionLike[] = [],
  config: AllocationConfig = DEFAULT_ALLOCATION,
): { decisions: AllocationDecision[]; byTicker: Map<string, AllocationDecision> } {
  const candidates = setups.map((s) => ({
    ticker: s.ticker,
    direction: dir(s.direction),
    score: s.score,
    ev: s.ev ?? null,
    sector: sectorFor(s.ticker),
  }));
  const existing = openPositions.map((p) => ({
    ticker: p.ticker,
    direction: dir(p.direction),
    sector: sectorFor(p.ticker),
  }));

  const decisions = allocate(candidates, existing, config);
  const byTicker = new Map<string, AllocationDecision>();
  for (const d of decisions) byTicker.set(d.ticker.toUpperCase(), d);
  return { decisions, byTicker };
}

/** Open positions from ledger rows — only the working states seed opportunity cost. */
export function openPositionsFromLedger(
  rows: Array<{ ticker: string; direction: "long" | "short"; status?: string | null }>,
): OpenPositionLike[] {
  const OPEN = new Set(["OPEN", "HOLD", "TRIM"]);
  return rows
    .filter((r) => r.status != null && OPEN.has(r.status.toUpperCase()))
    .map((r) => ({ ticker: r.ticker, direction: r.direction }));
}
