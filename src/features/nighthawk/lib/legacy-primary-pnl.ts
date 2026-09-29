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
    // Mirror legacyPrimaryPeakPct's fallback: when no trough has been latched yet
    // (fresh position, live-sync hasn't ticked), the worst-so-far is honestly the
    // current P&L, not unknown. BUG FIX (2026-09-17): this used to fall back to
    // `null`, so TerminalPremiumPanels' side-by-side Best/Worst showed a populated
    // "Best" and a blank "Worst" for the exact same freshly-opened position.
    return play.trough ?? play.pnlPct;
  }
  return play.stockTroughPct ?? play.trough ?? null;
}

export function legacyUsesOptionPnl(play: TerminalPlay): boolean {
  return play.pnlPct != null && Number.isFinite(play.pnlPct);
}
