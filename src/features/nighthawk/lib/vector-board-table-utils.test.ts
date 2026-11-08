import assert from "node:assert/strict";
import { test } from "node:test";
import type { VectorClosurePlay, VectorLeaderPlay } from "@/features/nighthawk/components/VectorPickLogBoard.types";
import {
  buildVectorBoardRows,
  closureStatus,
  closureToTableRow,
  leaderStatus,
  leaderToTableRow,
  vectorBoardCalendarBuckets,
  vectorBoardMeter,
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

test("buildVectorBoardRows open section excludes closed picks", () => {
  const winners = [leader({ id: 1 })];
  const leaders = [
    leader({ id: 1 }),
    leader({ id: 2, ticker: "NVDA", is_winner: false, premium_pct_from_entry: 22, peak_premium_pct: 24 }),
  ];
  const closedRows = [closure(), closure({ id: 10, ticker: "AAPL" })];
  const open = buildVectorBoardRows({ winners, leaders, closed: closedRows, section: "open" });
  assert.equal(open.length, 2);
  assert.equal(open.filter((r) => r.kind === "closed").length, 0);
});

test("vectorBoardCalendarBuckets aggregates session tone", () => {
  const rows = [leaderToTableRow(leader()), closureToTableRow(closure({ premium_pct_from_entry: 10 }))];
  const buckets = vectorBoardCalendarBuckets(rows);
  assert.equal(buckets.length, 2);
  assert.equal(buckets.find((b) => b.session_date === "2026-08-28")?.tone, "up");
  assert.equal(buckets.find((b) => b.session_date === "2026-08-27")?.tone, "up");
});

test("vectorBoardCalendarBuckets excludes rows with no usable premium from the blended average", () => {
  // BUG FIX (round 407): a day with one real +100% pick and one row carrying NO premium at
  // all (a freshly-surfaced live leader before its first price prints, or a closed pick that
  // never got a fill — both ship `premium_pct_from_entry: null` per VectorPickLogBoard.types.ts)
  // used to average +50% (dividing the real +100% by n=2, the undated row counting toward the
  // divisor while contributing 0 to the numerator) instead of the honest +100%. Same dilution
  // shape as the already-fixed Legacy sibling (legacyBoardCalendarBuckets, 2026-09-15 VNCE
  // incident) and the scorecard (vectorBoardScorecard's netPremiumPct, which already divides by
  // the premium-bearing count, not the row count).
  const realWinner = leaderToTableRow(leader({ premium_pct_from_entry: 100, peak_premium_pct: 100 }));
  const noPremiumYet = leaderToTableRow(
    leader({
      id: 2,
      ticker: "NVDA",
      session_date: realWinner.sessionDate,
      is_winner: false,
      premium_pct_from_entry: null,
      peak_premium_pct: null,
      action_status: "still_buy",
    })
  );
  const buckets = vectorBoardCalendarBuckets([realWinner, noPremiumYet]);
  const bucket = buckets.find((b) => b.session_date === realWinner.sessionDate);
  assert.ok(bucket);
  assert.equal(bucket!.n, 2); // both rows still counted as part of the day
  assert.equal(bucket!.net_premium_pct, 100); // but the average is NOT diluted by the undated row
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
