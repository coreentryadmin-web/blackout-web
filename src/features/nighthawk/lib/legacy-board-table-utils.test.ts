import assert from "node:assert/strict";
import { test } from "node:test";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  buildLegacyBoardRows,
  terminalPlayToLegacyRow,
} from "@/features/nighthawk/lib/legacy-board-table-utils";

function basePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "LEGACY-AAPL",
    ticker: "AAPL",
    contract: "AAPL 200C 3/21",
    direction: "CALL",
    status: "OPEN",
    recommendation: "BUY",
    rank: 1,
    factors: [],
    gates: [],
    thesisBreak: null,
    ...overrides,
  } as TerminalPlay;
}

test("terminalPlayToLegacyRow maps premium and session fields", () => {
  const row = terminalPlayToLegacyRow(
    basePlay({
      entryCostPerContract: 2.5,
      mark: 3.1,
      pnlPct: 24,
      tierLabel: "A",
      edition_for: undefined,
    }),
    "2026-03-01"
  );
  assert.equal(row.ticker, "AAPL");
  assert.equal(row.sessionDate, "2026-03-01");
  assert.equal(row.premiumPct, 24);
  assert.equal(row.tier, "elite");
  assert.equal(row.entryMid, 2.5);
  assert.equal(row.markMid, 3.1);
});

test("buildLegacyBoardRows splits open vs closed", () => {
  const plays = [
    basePlay({ id: "open-1", status: "OPEN" }),
    basePlay({ id: "closed-1", status: "SKIP", ticker: "MSFT" }),
  ];
  const open = buildLegacyBoardRows(plays, "open", "2026-03-01");
  const closed = buildLegacyBoardRows(plays, "closed", "2026-03-01");
  assert.equal(open.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(open[0]?.ticker, "AAPL");
  assert.equal(closed[0]?.ticker, "MSFT");
});
