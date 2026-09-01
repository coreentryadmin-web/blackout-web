import assert from "node:assert/strict";
import { test } from "node:test";
import type { VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  filterVectorBoardRowsAdvanced,
  sortVectorBoardRows,
  vectorBoardActiveFilterCount,
  vectorBoardNetPnl,
  vectorBoardSessionPnl,
} from "./vector-board-filters";

function row(overrides: Partial<VectorBoardTableRow> = {}): VectorBoardTableRow {
  return {
    key: "k1",
    kind: "live",
    status: "open",
    statusLabel: "Open",
    ticker: "INTC",
    contractLabel: "30C",
    occ: "INTC260117C00030000",
    sessionDate: "2026-08-28",
    rank: 1,
    tier: "elite",
    entryMid: 1,
    markMid: 1.5,
    premiumPct: 50,
    peakPct: 55,
    progressPct: 90,
    reason: "Desk still likes flow",
    timestamp: "2026-08-28T15:00:00.000Z",
    setupInvalidated: false,
    ...overrides,
  };
}

test("sortVectorBoardRows sorts by pnl descending", () => {
  const sorted = sortVectorBoardRows(
    [row({ premiumPct: 10, key: "a" }), row({ premiumPct: 40, key: "b" })],
    "pnl",
    "desc"
  );
  assert.equal(sorted[0]!.premiumPct, 40);
});

test("filterVectorBoardRowsAdvanced filters status and tier", () => {
  const rows = [
    row({ status: "winner", statusLabel: "Winner", tier: "elite" }),
    row({ key: "k2", status: "open", statusLabel: "Open", tier: "standard", ticker: "AMD" }),
  ];
  const winners = filterVectorBoardRowsAdvanced(rows, { statusFilter: "winner" });
  assert.equal(winners.length, 1);
  assert.equal(winners[0]!.ticker, "INTC");

  const elite = filterVectorBoardRowsAdvanced(rows, { tierFilter: "elite" });
  assert.equal(elite.length, 1);
});

test("vectorBoardNetPnl sums premium readings", () => {
  const net = vectorBoardNetPnl([
    row({ premiumPct: 30 }),
    row({ key: "k2", premiumPct: -10 }),
    row({ key: "k3", premiumPct: null }),
  ]);
  assert.equal(net, 20);
});

test("vectorBoardSessionPnl scopes to session date", () => {
  const net = vectorBoardSessionPnl(
    [row({ premiumPct: 20 }), row({ key: "k2", sessionDate: "2026-08-27", premiumPct: 99 })],
    "2026-08-28"
  );
  assert.equal(net, 20);
});

test("vectorBoardActiveFilterCount counts active filters", () => {
  assert.equal(
    vectorBoardActiveFilterCount({
      statusFilter: "winner",
      tierFilter: "all",
      reasonFilter: "all",
      selectedDate: "2026-08-28",
      tickerQuery: "INTC",
    }),
    3
  );
});
