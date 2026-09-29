import assert from "node:assert/strict";
import { test } from "node:test";
import {
  legacyPrimaryPeakPct,
  legacyPrimaryPnlPct,
  legacyPrimaryTroughPct,
  legacyUsesOptionPnl,
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
  assert.equal(legacyUsesOptionPnl(play({ pnlPct: 10 })), true);
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
