import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleSwingServingLane, emptySwingServingLane } from "./serving-board.ts";
import { SWING_SERVING_SECTIONS } from "./serving.ts";
import { HORIZONS } from "../horizons.ts";
import type { HorizonPlay } from "../horizon-plays.ts";
import type { ChainContract } from "../horizon-fanout.ts";

const contract: ChainContract = {
  ticker: "AAA", right: "C", expiry: "2026-08-07", dte: 14, strike: 100,
  delta: 0.6, openInterest: 3000, bid: 1.2, ask: 1.3, mid: 1.25,
};

function swingPlay(over: Partial<HorizonPlay>): HorizonPlay {
  return {
    ticker: "AAA", direction: "LONG", horizon: "SWING", score: 80, status: "COMMIT",
    contract, scoreFloor: 60, reason: "test", ...over,
  };
}

test("assembleSwingServingLane: all seven sections present; pre-entry populated, live-position empty", () => {
  const lane = assembleSwingServingLane([
    swingPlay({ ticker: "COM", setupState: "TRIGGERED", entryStatus: "AT_TRIGGER", status: "COMMIT" }),
    swingPlay({ ticker: "WAT", setupState: "FORMING", status: "COMMIT" }),
    swingPlay({ ticker: "UNDER", setupState: "TRIGGERED", entryStatus: "AT_TRIGGER", status: "WATCH" }),
    swingPlay({ ticker: "RES", status: "WATCH" }), // no setupState → RESEARCH
  ]);
  // Every bucket present (empty ones included).
  for (const s of SWING_SERVING_SECTIONS) assert.ok(Array.isArray(lane.sections[s]), s);
  // Pre-entry sections populated…
  assert.equal(lane.sections.COMMIT_NOW[0]!.ticker, "COM");
  assert.deepEqual(lane.sections.WATCH.map((p) => p.ticker), ["WAT", "UNDER"]);
  assert.equal(lane.sections.RESEARCH[0]!.ticker, "RES");
  // …and the three LIVE-POSITION sections are EMPTY until PR-13 persists positions.
  assert.equal(lane.sections.MANAGING.length, 0);
  assert.equal(lane.sections.SCALING_OUT.length, 0);
  assert.equal(lane.sections.EXITING.length, 0);
});

test("assembleSwingServingLane: provisional-floor badge + null calibrated surfaces", () => {
  const lane = assembleSwingServingLane([swingPlay({ status: "COMMIT" })]);
  assert.equal(lane.horizon, "SWING");
  assert.equal(lane.scoreFloor, HORIZONS.SWING.scoreFloor);
  assert.equal(lane.scoreFloorGraduated, false); // PROVISIONAL — the desk marks it not-yet-graded
  assert.equal(lane.calibratedProbability, null); // nothing graduated → renders —
  assert.equal(lane.expectedValue, null);
});

test("assembleSwingServingLane: committed/watch back-compat views + counts track status", () => {
  const lane = assembleSwingServingLane([
    swingPlay({ ticker: "A", status: "COMMIT" }),
    swingPlay({ ticker: "B", status: "WATCH" }),
    swingPlay({ ticker: "C", status: "WATCH" }),
  ]);
  assert.equal(lane.committedCount, 1);
  assert.equal(lane.watchCount, 2);
  assert.deepEqual(lane.watch.map((p) => p.ticker), ["B", "C"]);
});

test("emptySwingServingLane: structured, empty, member-safe default", () => {
  const lane = emptySwingServingLane();
  assert.equal(lane.committedCount, 0);
  assert.equal(lane.watchCount, 0);
  for (const s of SWING_SERVING_SECTIONS) assert.equal(lane.sections[s].length, 0);
  assert.equal(lane.scoreFloorGraduated, false);
});
