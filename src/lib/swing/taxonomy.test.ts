import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SWING_ARCHETYPES,
  ARCHETYPE_PRIORITY,
  ARCHETYPE_META,
  SWING_SUB_LANES,
  SWING_SUB_LANES_ORDER,
  subLaneForDte,
  allSwingSubLanes,
} from "./taxonomy.ts";

test("archetypes: 8 members, each has meta, priority is a permutation", () => {
  assert.equal(SWING_ARCHETYPES.length, 8);
  for (const a of SWING_ARCHETYPES) {
    assert.ok(ARCHETYPE_META[a], `meta for ${a}`);
    assert.equal(ARCHETYPE_META[a].id, a);
    assert.equal(ARCHETYPE_META[a].scoreFloorGraduated, false, `${a} floor must be provisional`);
    assert.ok(ARCHETYPE_META[a].scoreFloor >= 50 && ARCHETYPE_META[a].scoreFloor <= 100);
  }
  // priority is a permutation of the archetype list (no missing / duplicate)
  assert.deepEqual([...ARCHETYPE_PRIORITY].sort(), [...SWING_ARCHETYPES].sort());
  assert.equal(new Set(ARCHETYPE_PRIORITY).size, SWING_ARCHETYPES.length);
});

test("subLaneForDte: boundaries — outside [2,30] is null, each lane owns its inclusive range", () => {
  assert.equal(subLaneForDte(1), null);
  assert.equal(subLaneForDte(2), "TACTICAL");
  assert.equal(subLaneForDte(7), "TACTICAL");
  assert.equal(subLaneForDte(8), "STANDARD");
  assert.equal(subLaneForDte(21), "STANDARD");
  assert.equal(subLaneForDte(22), "EXTENDED");
  assert.equal(subLaneForDte(30), "EXTENDED");
  assert.equal(subLaneForDte(31), null);
  assert.equal(subLaneForDte(0), null);
  assert.equal(subLaneForDte(NaN), null);
});

test("sub-lanes: ranges are contiguous, non-overlapping, cover exactly [2,30]", () => {
  const lanes = allSwingSubLanes();
  assert.equal(lanes.length, 3);
  // contiguous + non-overlapping in fast→slow order, covering [2,30]
  assert.equal(lanes[0]!.dteMin, 2);
  assert.equal(lanes[lanes.length - 1]!.dteMax, 30);
  for (let i = 1; i < lanes.length; i++) {
    assert.equal(lanes[i]!.dteMin, lanes[i - 1]!.dteMax + 1, `lane ${i} starts right after prior`);
  }
  // every DTE in [2,30] maps to exactly one lane; every DTE outside maps to none
  for (let dte = 0; dte <= 35; dte++) {
    const lane = subLaneForDte(dte);
    const inWindow = dte >= 2 && dte <= 30;
    assert.equal(lane != null, inWindow, `dte ${dte} in-window=${inWindow}`);
  }
});

test("sub-lanes: directional stance is baked in (targetDelta >= 0.50), floors provisional, exit SCALE_OUT", () => {
  for (const id of SWING_SUB_LANES_ORDER) {
    const s = SWING_SUB_LANES[id];
    // SEV-4: the swing instrument is a directional 0.50–0.75Δ contract, NOT the 0.35Δ banger.
    assert.ok(s.contract.targetDelta >= 0.5, `${id} targetDelta ${s.contract.targetDelta} must be >= 0.50`);
    assert.ok(s.contract.deltaBand[0] >= 0.5, `${id} delta band floor must be >= 0.50`);
    assert.equal(s.scoreFloorGraduated, false, `${id} floor must be provisional`);
    assert.equal(s.exit, "SCALE_OUT");
    assert.ok(s.thetaSensitivity >= 0 && s.thetaSensitivity <= 1);
    assert.ok(s.earningsHazard >= 0 && s.earningsHazard <= 1);
  }
  // theta penalty is harshest on the shortest lane, most lenient on the longest (FM#2 divergence).
  assert.ok(SWING_SUB_LANES.TACTICAL.thetaSensitivity > SWING_SUB_LANES.EXTENDED.thetaSensitivity);
  // grader timeframes pinned per lane (SEV-9).
  assert.equal(SWING_SUB_LANES.TACTICAL.grader, "minute");
  assert.equal(SWING_SUB_LANES.STANDARD.grader, "hour");
  assert.equal(SWING_SUB_LANES.EXTENDED.grader, "day");
});
