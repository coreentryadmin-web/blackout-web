import assert from "node:assert/strict";
import { test } from "node:test";
import type { VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  filterVectorBoardRowsAdvanced,
  sortVectorBoardRows,
  stepBoardSelectionIndex,
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

// ── Bug: ArrowDown re-clamped a stale currentIndex to the list's CURRENT bound before
// stepping (Math.min(listLength-1, currentIndex+1) always lands in range regardless of
// how stale currentIndex is), but the pre-fix ArrowUp handler only applied Math.max(0, ...)
// to the STALE index directly, with no upper re-clamp -- after a filter/tab/search change
// shrinks the visible list while a high index was selected, ArrowUp needed several extra
// keypresses (stepping through now-nonexistent positions) before landing on a real row. ──

test("stepBoardSelectionIndex: ArrowUp direction recovers a real row in ONE step from a stale high index", () => {
  // currentIndex=7 is stale (left over from a longer list); the list has since shrunk to 3 rows.
  const next = stepBoardSelectionIndex(7, 3, -1);
  assert.equal(next, 1, "must land inside [0, 2] immediately, not decrement 7->6 (out of range)");
});

test("stepBoardSelectionIndex: ArrowDown direction still lands at the last valid index from a stale high index", () => {
  const next = stepBoardSelectionIndex(7, 3, 1);
  assert.equal(next, 2);
});

test("stepBoardSelectionIndex: normal in-range stepping is unchanged", () => {
  assert.equal(stepBoardSelectionIndex(1, 5, 1), 2);
  assert.equal(stepBoardSelectionIndex(1, 5, -1), 0);
  assert.equal(stepBoardSelectionIndex(0, 5, -1), 0, "clamps at the floor");
  assert.equal(stepBoardSelectionIndex(4, 5, 1), 4, "clamps at the ceiling");
});

test("stepBoardSelectionIndex: an empty list returns 0 rather than a negative index", () => {
  assert.equal(stepBoardSelectionIndex(0, 0, -1), 0);
  assert.equal(stepBoardSelectionIndex(0, 0, 1), 0);
});
