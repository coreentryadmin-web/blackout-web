import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";

/** Live Legacy PnL: option premium vs entry when marks exist; else underlying stock move.
 *
 * BUG FIX (2026-11-01, Night Hawk Legacy / Ask Largo standing mandate — 4th instance of this
 * exact WATCH/SKIP-exclusion defect in this file family): WATCH means no position has been
 * entered yet — status stays WATCH from publish (~8pm ET) until the next morning's 9:15am ET
 * morning-confirm cron runs, and stays WATCH afterward for DEGRADED/UNVERIFIED verdicts too
 * (terminalPlayFromEdition, adapters.ts — only INVALIDATED/severe-pulled maps to SKIP, only
 * CONFIRMED maps to OPEN). SKIP means invalidated/pulled — also never entered. `play.pnlPct` is
 * already nulled upstream for both statuses (overlayLegacyOptionMarks / overlayLegacyQuotes,
 * #7105), but `play.stockMovePct` — the fallback this helper reaches for — is computed
 * UNCONDITIONALLY for every status (use-legacy-quotes.ts's `overlayLegacyQuotes`), so the `??`
 * chain below used to silently resolve to a fabricated "position" P&L (the underlying's
 * hypothetical move from the published entry-band midpoint) for a play that was never entered —
 * reached through LegacyPlayDetailPanel's verdict band ("{movePct}% from entry") and the
 * PlayTerminal header stream's identical text, both rendered for every Legacy play unconditionally.
 * Mirrors the identical WATCH/SKIP exclusion already applied at 3 sibling call sites: the
 * recommendation/recNote SELL/TRIM override (use-legacy-quotes.ts), the zoneLabel "cut the
 * position"/"take profit" text (legacy-play-geometry.tsx), and pnlPct/execPnlPct
 * (use-legacy-option-marks.ts).
 */
export function legacyPrimaryPnlPct(play: TerminalPlay): number | null {
  if (play.status === "WATCH" || play.status === "SKIP") return null;
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
