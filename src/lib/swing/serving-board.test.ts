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
    swingPlay({
      ticker: "COM",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      status: "COMMIT",
      bucketGraduated: true,
    }),
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
    // A real COMMIT_NOW candidate (triggered + at-trigger), not just a bare status:"COMMIT" — see the
    // FIX comment above assembleSwingServingLane: an unclassified play (no setupState) with status:"COMMIT"
    // is a gate-blocked/non-actionable thesis, not a committed one, and the router correctly sends it to
    // RESEARCH rather than counting it here.
    swingPlay({ ticker: "A", status: "COMMIT", setupState: "TRIGGERED", entryStatus: "AT_TRIGGER" }),
    swingPlay({ ticker: "B", status: "WATCH", setupState: "FORMING" }),
    swingPlay({ ticker: "C", status: "WATCH", setupState: "FORMING" }),
  ]);
  assert.equal(lane.committedCount, 1);
  assert.equal(lane.watchCount, 2);
  assert.deepEqual(lane.watch.map((p) => p.ticker), ["B", "C"]);
});

// FIX (Ask Largo standing mandate, live-verified 2026-09-23): `watch` used to be re-derived
// independently from raw `p.status === "WATCH"`, bypassing the router entirely. A name whose
// entry-validity window expired routes to `sections.RESEARCH` (PR #337, 2026-09-22) but the
// back-compat `watch` field — the field GET /api/market/nighthawk/horizons?view=swings actually
// serves as board.lanes.SWING.watch, read directly by Largo's tools — kept including it anyway.
// Live repro: AMZN, TACTICAL sub-lane (2-day entry window), first flagged 15 days earlier, still
// showing in board.lanes.SWING.watch while its own play-brief correctly said "Serving section:
// RESEARCH... entry-validity window expired".
test("assembleSwingServingLane: watch back-compat view excludes a name whose entry-validity window expired (matches sections.RESEARCH, not stale raw status)", () => {
  const stale = swingPlay({
    ticker: "STALE",
    status: "WATCH",
    setupState: "FORMING",
    firstSeenAt: new Date(Date.now() - 26 * 24 * 60 * 60 * 1000).toISOString(),
    subLane: "STANDARD", // 3-day window — 26 days is unambiguously past it
  });
  const fresh = swingPlay({ ticker: "FRESH", status: "WATCH", setupState: "FORMING" });
  const lane = assembleSwingServingLane([stale, fresh]);
  assert.deepEqual(
    lane.watch.map((p) => p.ticker),
    ["FRESH"],
    "an entry-window-expired name must not appear in the back-compat watch[] array",
  );
  assert.equal(lane.watchCount, 1);
  assert.equal(
    lane.sections.RESEARCH.some((p) => p.ticker === "STALE"),
    true,
    "the expired name must still be reachable in sections.RESEARCH — routed away, not dropped",
  );
});

// FIX (Ask Largo standing mandate, live-verified 2026-09-25): `committed` had the same bug class as the
// `watch` fix above — re-derived from raw `p.status === "COMMIT"`, which is only the mechanical floor-gate
// result, not "this is an actionable or live position." A gate-blocked pre-entry thesis (real
// `commitGateBlockedBy`, no `positionId`) still carries `status:"COMMIT"` but the router correctly places
// it in WATCH/RESEARCH, never COMMIT_NOW. Live repro: board.lanes.SWING.committedCount read 91 while
// GET /api/market/swing/record's real open-position count was 82 — gate-blocked theses double-counted.
test("assembleSwingServingLane: committed back-compat view excludes a gate-blocked thesis with no live position (matches sections.COMMIT_NOW/MANAGING/SCALING_OUT/EXITING, not stale raw status)", () => {
  const gateBlocked = swingPlay({
    ticker: "BLOCKED",
    status: "COMMIT", // mechanical floor-gate result only — aboveFloor:true
    setupState: "FORMING", // router places a FORMING name in WATCH regardless of aboveFloor
    commitGateBlockedBy: ["gate:G-S12:halt_feed_stale"],
  });
  const realCommitNow = swingPlay({
    ticker: "REAL",
    status: "COMMIT",
    setupState: "TRIGGERED",
    entryStatus: "AT_TRIGGER",
  });
  const livePosition = swingPlay({
    ticker: "OPEN",
    status: "COMMIT",
    liveStatus: "OPEN",
  });
  const lane = assembleSwingServingLane([gateBlocked, realCommitNow, livePosition]);
  assert.deepEqual(
    lane.committed.map((p) => p.ticker).sort(),
    ["OPEN", "REAL"],
    "a gate-blocked, no-position thesis must not appear in the back-compat committed[] array",
  );
  assert.equal(lane.committedCount, 2);
  assert.equal(
    lane.sections.WATCH.some((p) => p.ticker === "BLOCKED"),
    true,
    "the gate-blocked name must still be reachable in sections.WATCH — routed away, not dropped",
  );
});

test("emptySwingServingLane: structured, empty, member-safe default", () => {
  const lane = emptySwingServingLane();
  assert.equal(lane.committedCount, 0);
  assert.equal(lane.watchCount, 0);
  for (const s of SWING_SERVING_SECTIONS) assert.equal(lane.sections[s].length, 0);
  assert.equal(lane.scoreFloorGraduated, false);
});
