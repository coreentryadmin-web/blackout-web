import assert from "node:assert/strict";
import { test } from "node:test";
import {
  legacyPrimaryPeakPct,
  legacyPrimaryPnlPct,
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
