import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";

/** Live Legacy PnL: option premium vs entry when marks exist; else underlying stock move. */
export function legacyPrimaryPnlPct(play: TerminalPlay): number | null {
  return play.pnlPct ?? play.stockMovePct ?? null;
}

export function legacyPrimaryPeakPct(play: TerminalPlay): number | null {
  if (play.pnlPct != null && Number.isFinite(play.pnlPct)) {
    return play.peak ?? play.pnlPct;
  }
  return play.stockPeakPct ?? play.peak ?? null;
}

export function legacyPrimaryTroughPct(play: TerminalPlay): number | null {
  if (play.pnlPct != null && Number.isFinite(play.pnlPct)) {
    return play.trough ?? null;
  }
  return play.stockTroughPct ?? play.trough ?? null;
}

export function legacyUsesOptionPnl(play: TerminalPlay): boolean {
  return play.pnlPct != null && Number.isFinite(play.pnlPct);
}
