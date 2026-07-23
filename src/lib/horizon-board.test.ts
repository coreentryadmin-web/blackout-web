import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleHorizonBoard, makePlaySet, scopeBoardToHorizon } from "./horizon-board.ts";
import type { HorizonPlay } from "./horizon-plays.ts";
import type { ChainContract } from "./horizon-fanout.ts";

const contract: ChainContract = {
  ticker: "SPY", right: "C", expiry: "2026-07-23", dte: 0, strike: 100,
  delta: 0.5, openInterest: 5000, bid: 1, ask: 1.1, mid: 1.05,
};

function play(over: Partial<HorizonPlay>): HorizonPlay {
  return {
    ticker: "SPY", direction: "LONG", horizon: "ZERO_DTE", score: 80, status: "COMMIT",
    contract, scoreFloor: 65, reason: "test", ...over,
  };
}

test("assembles all three lanes with spec metadata even when some are empty", () => {
  const board = assembleHorizonBoard(makePlaySet({ ZERO_DTE: [play({})] }), "2026-07-23T15:00:00Z");
  assert.deepEqual(board.order, ["ZERO_DTE", "SWING", "LEAPS"]);
  assert.equal(board.lanes.ZERO_DTE.label, "0DTE");
  assert.equal(board.lanes.SWING.label, "Swing");
  assert.equal(board.lanes.LEAPS.label, "LEAPS");
  // spec metadata carried through
  assert.equal(board.lanes.ZERO_DTE.exit, "RATCHET");
  assert.equal(board.lanes.SWING.exit, "SCALE_OUT");
  assert.equal(board.lanes.ZERO_DTE.scoreFloorGraduated, true);
  assert.equal(board.lanes.SWING.scoreFloorGraduated, false); // provisional — UI must mark it
  // empty lanes still present
  assert.equal(board.lanes.LEAPS.committedCount, 0);
});

test("splits committed vs watch per lane and totals across the board", () => {
  const board = assembleHorizonBoard(
    makePlaySet({
      ZERO_DTE: [play({ status: "COMMIT" }), play({ ticker: "QQQ", status: "WATCH" })],
      SWING: [play({ horizon: "SWING", status: "COMMIT", scoreFloor: 60 })],
    }),
    "2026-07-23T15:00:00Z",
  );
  assert.equal(board.lanes.ZERO_DTE.committedCount, 1);
  assert.equal(board.lanes.ZERO_DTE.watchCount, 1);
  assert.equal(board.lanes.ZERO_DTE.committed[0]!.ticker, "SPY");
  assert.equal(board.lanes.ZERO_DTE.watch[0]!.ticker, "QQQ");
  assert.equal(board.lanes.SWING.committedCount, 1);
  assert.equal(board.totalCommitted, 2);
  assert.equal(board.totalWatch, 1);
});

test("asOf is caller-stamped verbatim (module stays pure)", () => {
  const board = assembleHorizonBoard(makePlaySet({}), "2026-07-23T09:41:00Z");
  assert.equal(board.asOf, "2026-07-23T09:41:00Z");
  assert.equal(board.totalCommitted, 0);
});

test("scopeBoardToHorizon keeps only the selected lane's plays; others stay present but empty", () => {
  const full = assembleHorizonBoard(
    makePlaySet({
      ZERO_DTE: [play({ status: "COMMIT" })],
      SWING: [play({ horizon: "SWING", status: "COMMIT", scoreFloor: 60 }), play({ ticker: "QQQ", horizon: "SWING", status: "WATCH", scoreFloor: 60 })],
    }),
    "2026-07-23T15:00:00Z",
  );
  const swingOnly = scopeBoardToHorizon(full, "SWING");
  assert.equal(swingOnly.lanes.SWING.committedCount, 1);
  assert.equal(swingOnly.lanes.SWING.watchCount, 1);
  assert.equal(swingOnly.lanes.ZERO_DTE.committedCount, 0); // emptied
  assert.equal(swingOnly.lanes.ZERO_DTE.committed.length, 0);
  assert.equal(swingOnly.lanes.ZERO_DTE.label, "0DTE"); // ...but still PRESENT for the toggle chip
  assert.equal(swingOnly.totalCommitted, 1); // recomputed to the surviving lane
  assert.equal(swingOnly.totalWatch, 1);
});

test("scopeBoardToHorizon with null (legacy/all-lanes view) returns the board unchanged", () => {
  const full = assembleHorizonBoard(makePlaySet({ ZERO_DTE: [play({})] }), "2026-07-23T15:00:00Z");
  assert.equal(scopeBoardToHorizon(full, null), full);
});
