import assert from "node:assert/strict";
import { test } from "node:test";
import type { VectorClosurePlay, VectorLeaderPlay } from "@/features/nighthawk/components/VectorPickLogBoard.types";
import {
  buildVectorBoardRows,
  closureStatus,
  closureToTableRow,
  filterVectorBoardRows,
  leaderStatus,
  leaderToTableRow,
  vectorBoardCalendarBuckets,
  vectorBoardMeter,
  vectorBoardSummary,
} from "./vector-board-table-utils";

function leader(overrides: Partial<VectorLeaderPlay> = {}): VectorLeaderPlay {
  return {
    id: 1,
    ticker: "INTC",
    session_date: "2026-08-28",
    contract: {
      occ: "INTC260117C00030000",
      side: "call",
      strike: 30,
      expiry: "2026-01-17",
      label: "30C Jan'26",
    },
    rank: 2,
    role: null,
    entry_mid: 1.2,
    live_mid: 1.8,
    premium_pct_from_entry: 50,
    peak_premium_pct: 55,
    action_status: "still_buy",
    action_reason: "Desk still likes flow",
    setup_invalidated: false,
    spot: 31,
    updated_at: "2026-08-28T15:00:00.000Z",
    is_winner: true,
    tier: "elite",
    ...overrides,
  };
}

function closure(overrides: Partial<VectorClosurePlay> = {}): VectorClosurePlay {
  return {
    id: 9,
    ticker: "TSLA",
    session_date: "2026-08-27",
    contract: {
      occ: "TSLA260117P00250000",
      side: "put",
      strike: 250,
      expiry: "2026-01-17",
      label: "250P Jan'26",
    },
    rank: 1,
    role: null,
    entry_mid: 2,
    close_mid: 1.5,
    premium_pct_from_entry: -25,
    close_reason: "Setup invalidated",
    setup_invalidated: true,
    spot: 255,
    closed_at: "2026-08-27T16:00:00.000Z",
    ...overrides,
  };
}

test("leaderStatus maps winner and runner states", () => {
  assert.deepEqual(leaderStatus(leader({ is_winner: true })), { status: "winner", label: "Winner" });
  assert.deepEqual(leaderStatus(leader({ is_winner: false, premium_pct_from_entry: 20, peak_premium_pct: 22 })), {
    status: "runner",
    label: "Runner",
  });
  assert.deepEqual(leaderStatus(leader({ action_status: "caution", is_winner: false, premium_pct_from_entry: 5 })), {
    status: "caution",
    label: "Caution",
  });
});

test("closureStatus maps invalidated and winner closures", () => {
  assert.deepEqual(closureStatus(closure()), { status: "invalidated", label: "Invalidated" });
  assert.deepEqual(
    closureStatus(closure({ setup_invalidated: false, premium_pct_from_entry: 60, close_reason: "Desk cap" })),
    { status: "winner", label: "Winner" }
  );
});

test("buildVectorBoardRows dedupes winners from runners/live in all view", () => {
  const winners = [leader({ id: 1 })];
  const leaders = [
    leader({ id: 1 }),
    leader({ id: 2, ticker: "NVDA", is_winner: false, premium_pct_from_entry: 22, peak_premium_pct: 24 }),
    leader({ id: 3, ticker: "AMD", is_winner: false, premium_pct_from_entry: 4, peak_premium_pct: 4 }),
  ];
  const closedRows = [closure()];
  const all = buildVectorBoardRows({ winners, leaders, closed: closedRows, section: "all" });
  assert.equal(all.length, 4);
  assert.equal(all.filter((r) => r.kind === "winner").length, 1);
  assert.equal(all.filter((r) => r.kind === "runner").length, 1);
  assert.equal(all.filter((r) => r.kind === "live").length, 1);
  assert.equal(all.filter((r) => r.kind === "closed").length, 1);
});

test("filterVectorBoardRows filters by ticker and session", () => {
  const rows = [leaderToTableRow(leader()), closureToTableRow(closure())];
  const byTicker = filterVectorBoardRows(rows, { tickerQuery: "int" });
  assert.equal(byTicker.length, 1);
  assert.equal(byTicker[0]!.ticker, "INTC");

  const bySession = filterVectorBoardRows(rows, { sessionDate: "2026-08-27" });
  assert.equal(bySession.length, 1);
  assert.equal(bySession[0]!.ticker, "TSLA");
});

test("vectorBoardCalendarBuckets aggregates session tone", () => {
  const rows = [leaderToTableRow(leader()), closureToTableRow(closure({ premium_pct_from_entry: 10 }))];
  const buckets = vectorBoardCalendarBuckets(rows);
  assert.equal(buckets.length, 2);
  assert.equal(buckets.find((b) => b.session_date === "2026-08-28")?.tone, "up");
  assert.equal(buckets.find((b) => b.session_date === "2026-08-27")?.tone, "up");
});

test("vectorBoardSummary counts open, closed, and winners", () => {
  const rows = [
    leaderToTableRow(leader({ is_winner: true })),
    leaderToTableRow(leader({ id: 2, ticker: "NVDA", is_winner: false, premium_pct_from_entry: 20, peak_premium_pct: 22 })),
    closureToTableRow(closure()),
  ];
  const summary = vectorBoardSummary(rows);
  assert.equal(summary.total, 3);
  assert.equal(summary.winners, 1);
  assert.equal(summary.open, 1);
  assert.equal(summary.closed, 1);
  assert.equal(summary.avgPct, 15);
  assert.equal(summary.netPnl, 45);
});

test("vectorBoardMeter mirrors X Ads budget bar for peak and winner floor", () => {
  const peakRow = leaderToTableRow(leader({ premium_pct_from_entry: 40, peak_premium_pct: 50 }));
  const peakMeter = vectorBoardMeter(peakRow);
  assert.ok(peakMeter);
  assert.equal(peakMeter!.fillPct, 80);
  assert.equal(peakMeter!.caption, "80%");

  const floorRow = leaderToTableRow(
    leader({ is_winner: false, premium_pct_from_entry: 25, peak_premium_pct: null })
  );
  const floorMeter = vectorBoardMeter(floorRow);
  assert.ok(floorMeter);
  assert.equal(floorMeter!.fillPct, 50);
  assert.equal(floorMeter!.caption, "50%");
});
