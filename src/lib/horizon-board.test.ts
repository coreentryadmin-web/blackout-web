import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleHorizonBoard, makePlaySet, scopeBoardToHorizon, withLane } from "./horizon-board.ts";
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

test("SWING lane carries the seven serving sections; 0DTE/LEAPS carry none (back-compat intact)", () => {
  const board = assembleHorizonBoard(
    makePlaySet({
      ZERO_DTE: [play({ status: "COMMIT" })],
      SWING: [
        play({
          ticker: "COM",
          horizon: "SWING",
          scoreFloor: 60,
          status: "COMMIT",
          setupState: "TRIGGERED",
          entryStatus: "AT_TRIGGER",
          bucketGraduated: true,
        }),
        play({ ticker: "EXT", horizon: "SWING", scoreFloor: 60, status: "COMMIT", setupState: "EXTENDED", entryStatus: "PRE_TRIGGER" }),
      ],
    }),
    "2026-07-23T15:00:00Z",
  );
  // Graduated AT_TRIGGER → COMMIT_NOW; EXTENDED → WAITING_FOR_ENTRY (observable state, not the score).
  assert.equal(board.lanes.SWING.sections!.COMMIT_NOW[0]!.ticker, "COM");
  assert.equal(board.lanes.SWING.sections!.WAITING_FOR_ENTRY[0]!.ticker, "EXT");
  // 0DTE/LEAPS untouched: no sections, committed/watch still populated.
  assert.equal(board.lanes.ZERO_DTE.sections, undefined);
  assert.equal(board.lanes.LEAPS.sections, undefined);
  assert.equal(board.lanes.ZERO_DTE.committedCount, 1); // back-compat committed view intact
});

test("scopeBoardToHorizon zeroes sections on non-selected lanes; keeps them on the selected SWING lane", () => {
  const full = assembleHorizonBoard(
    makePlaySet({
      ZERO_DTE: [play({ status: "COMMIT" })],
      SWING: [
        play({
          ticker: "COM",
          horizon: "SWING",
          scoreFloor: 60,
          status: "COMMIT",
          setupState: "TRIGGERED",
          entryStatus: "AT_TRIGGER",
          bucketGraduated: true,
        }),
      ],
    }),
    "2026-07-23T15:00:00Z",
  );
  // Scope to 0DTE → SWING lane's sections are zeroed to null (no stale swing triage).
  const zeroOnly = scopeBoardToHorizon(full, "ZERO_DTE");
  assert.equal(zeroOnly.lanes.SWING.sections, null);
  assert.equal(zeroOnly.lanes.ZERO_DTE.sections, undefined); // 0DTE never had sections
  // Scope to SWING → its sections survive.
  const swingOnly = scopeBoardToHorizon(full, "SWING");
  assert.equal(swingOnly.lanes.SWING.sections!.COMMIT_NOW[0]!.ticker, "COM");
});

// The horizons route builds a board from the 0DTE payload and only THEN splices the SWING lane in. It
// used to do that with a plain object spread, which left totalCommitted/totalWatch describing the 0DTE
// lane alone — and on the all-lanes view scopeBoardToHorizon(board, null) is a no-op, so nothing
// downstream ever fixed them. These tests pin the re-derivation.
test("withLane re-derives the board totals after a lane is swapped in", () => {
  const zeroOnly = assembleHorizonBoard(
    makePlaySet({ ZERO_DTE: [play({ status: "COMMIT" })] }),
    "2026-08-14T18:00:00Z",
  );
  assert.equal(zeroOnly.totalCommitted, 1);
  assert.equal(zeroOnly.totalWatch, 0);

  // A SWING lane assembled elsewhere (the route gets this from getSwingServingLane), spliced in.
  const swingLane = assembleHorizonBoard(
    makePlaySet({
      SWING: [
        play({ ticker: "AAA", horizon: "SWING", scoreFloor: 60, status: "COMMIT" }),
        play({ ticker: "BBB", horizon: "SWING", scoreFloor: 60, status: "COMMIT" }),
        play({ ticker: "CCC", horizon: "SWING", scoreFloor: 60, status: "WATCH" }),
      ],
    }),
    "2026-08-14T18:00:00Z",
  ).lanes.SWING;

  const merged = withLane(zeroOnly, "SWING", swingLane);
  assert.equal(merged.lanes.SWING.committedCount, 2);
  assert.equal(merged.totalCommitted, 3, "0DTE 1 + SWING 2 — not the pre-splice 1");
  assert.equal(merged.totalWatch, 1);
  // The other lanes and the board envelope are untouched.
  assert.equal(merged.lanes.ZERO_DTE.committedCount, 1);
  assert.equal(merged.asOf, "2026-08-14T18:00:00Z");
  assert.deepEqual(merged.order, ["ZERO_DTE", "SWING", "LEAPS"]);
});

test("withLane totals stay correct when the replacement lane is EMPTY (no stale carry-over)", () => {
  // The failure mode is symmetric: a spread also keeps totals that a now-empty lane no longer earns.
  const full = assembleHorizonBoard(
    makePlaySet({
      ZERO_DTE: [play({ status: "COMMIT" })],
      SWING: [play({ ticker: "AAA", horizon: "SWING", scoreFloor: 60, status: "COMMIT" })],
    }),
    "2026-08-14T18:00:00Z",
  );
  assert.equal(full.totalCommitted, 2);
  const emptySwing = assembleHorizonBoard(makePlaySet({}), "2026-08-14T18:00:00Z").lanes.SWING;
  const merged = withLane(full, "SWING", emptySwing);
  assert.equal(merged.totalCommitted, 1);
  assert.equal(merged.totalWatch, 0);
});

test("withLane composes with scopeBoardToHorizon — a scoped view reports only its own lane", () => {
  const zeroOnly = assembleHorizonBoard(
    makePlaySet({ ZERO_DTE: [play({ status: "COMMIT" })] }),
    "2026-08-14T18:00:00Z",
  );
  const swingLane = assembleHorizonBoard(
    makePlaySet({ SWING: [play({ ticker: "AAA", horizon: "SWING", scoreFloor: 60, status: "COMMIT" })] }),
    "2026-08-14T18:00:00Z",
  ).lanes.SWING;
  const merged = withLane(zeroOnly, "SWING", swingLane);
  assert.equal(scopeBoardToHorizon(merged, "SWING").totalCommitted, 1);
  assert.equal(scopeBoardToHorizon(merged, "ZERO_DTE").totalCommitted, 1);
  assert.equal(scopeBoardToHorizon(merged, "LEAPS").totalCommitted, 0);
  assert.equal(scopeBoardToHorizon(merged, null).totalCommitted, 2, "all-lanes view is the sum");
});
