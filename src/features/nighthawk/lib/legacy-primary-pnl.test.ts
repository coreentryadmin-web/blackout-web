import assert from "node:assert/strict";
import { test } from "node:test";
import {
  legacyPrimaryPeakPct,
  legacyPrimaryPnlPct,
  legacyPrimaryTroughPct,
} from "./legacy-primary-pnl";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "t",
    ticker: "NVDA",
    direction: "LONG",
    horizon: "LEGACY",
    status: "OPEN",
    recommendation: "BUY",
    contract: "180C",
    ...overrides,
  } as TerminalPlay;
}

test("legacyPrimaryPnlPct prefers option premium over stock move", () => {
  assert.equal(
    legacyPrimaryPnlPct(play({ pnlPct: 42, stockMovePct: 2 })),
    42
  );
  assert.equal(legacyPrimaryPnlPct(play({ stockMovePct: 2 })), 2);
});

// BUG FIX (2026-11-01, Night Hawk Legacy / Ask Largo standing mandate — 4th instance of this
// exact WATCH/SKIP-exclusion defect in this file family): `stockMovePct` is computed
// unconditionally for every status (use-legacy-quotes.ts), so a WATCH (never entered) or SKIP
// (invalidated/pulled, never entered) play used to resolve to a fabricated "position" P&L here —
// the underlying's hypothetical move from the published entry-band midpoint, rendered as if a real
// position existed. Mirrors the identical WATCH/SKIP gate already applied to pnlPct/execPnlPct
// (use-legacy-option-marks.ts, #7105).
test("legacyPrimaryPnlPct returns null for WATCH/SKIP even when stockMovePct is a real non-null number — no position was ever entered to report a return on", () => {
  assert.equal(legacyPrimaryPnlPct(play({ status: "WATCH", stockMovePct: 14.2 })), null);
  assert.equal(legacyPrimaryPnlPct(play({ status: "SKIP", stockMovePct: -9.1 })), null);
  // Even if some caller populated pnlPct too (shouldn't happen upstream — overlayLegacyOptionMarks/
  // overlayLegacyQuotes already null it for these statuses — the gate must hold regardless).
  assert.equal(legacyPrimaryPnlPct(play({ status: "WATCH", pnlPct: 50, stockMovePct: 14.2 })), null);
});

test("legacyPrimaryPnlPct is unaffected for real-position statuses (OPEN/HOLD/TRIM/CLOSED) — no regression", () => {
  assert.equal(legacyPrimaryPnlPct(play({ status: "OPEN", stockMovePct: 14.2 })), 14.2);
  assert.equal(legacyPrimaryPnlPct(play({ status: "HOLD", pnlPct: 7, stockMovePct: 14.2 })), 7);
  assert.equal(legacyPrimaryPnlPct(play({ status: "TRIM", stockMovePct: 3 })), 3);
  assert.equal(legacyPrimaryPnlPct(play({ status: "CLOSED", stockMovePct: 3 })), 3);
});

test("legacyPrimaryPeakPct uses option peak when premium PnL is live", () => {
  assert.equal(legacyPrimaryPeakPct(play({ pnlPct: 10, peak: 80, stockPeakPct: 3 })), 80);
  assert.equal(legacyPrimaryPeakPct(play({ stockPeakPct: 3, peak: 1 })), 3);
});

test("legacyPrimaryPeakPct falls back to the live pnlPct when no peak has latched yet", () => {
  assert.equal(legacyPrimaryPeakPct(play({ pnlPct: 12 })), 12);
});

// BUG FIX (2026-09-17): trough used to fall back to null instead of pnlPct here,
// while peak (the identical case, one line up) correctly fell back to pnlPct —
// a fresh position with live option P&L but no latched trough_premium yet showed
// a populated "Best" and a blank "Worst" in TerminalPremiumPanels' side-by-side
// display for the exact same data-availability state.
test("legacyPrimaryTroughPct mirrors the peak fallback — falls back to the live pnlPct when no trough has latched yet", () => {
  assert.equal(legacyPrimaryTroughPct(play({ pnlPct: -8 })), -8);
});

test("legacyPrimaryTroughPct uses option trough when premium PnL is live and trough is latched", () => {
  assert.equal(legacyPrimaryTroughPct(play({ pnlPct: 10, trough: -20, stockTroughPct: -3 })), -20);
});

test("legacyPrimaryTroughPct falls back to stock trough when there is no option PnL", () => {
  assert.equal(legacyPrimaryTroughPct(play({ stockTroughPct: -3, trough: -1 })), -3);
});
