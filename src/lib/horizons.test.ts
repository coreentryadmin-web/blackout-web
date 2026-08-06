import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HORIZONS,
  HORIZON_ORDER,
  horizonForDte,
  dteFitsHorizon,
  allHorizons,
  exitPrimitiveFor,
  ZERODTE_MAX_DTE,
  type Horizon,
} from "./horizons.ts";

test("ZERODTE_MAX_DTE is the single exported ceiling and matches HORIZONS.ZERO_DTE.dteMax", () => {
  assert.equal(ZERODTE_MAX_DTE, 4);
  assert.equal(ZERODTE_MAX_DTE, HORIZONS.ZERO_DTE.dteMax);
});

test("windows are contiguous and non-overlapping [0,4] [5,30] [31,90]", () => {
  assert.deepEqual([HORIZONS.ZERO_DTE.dteMin, HORIZONS.ZERO_DTE.dteMax], [0, 4]);
  assert.deepEqual([HORIZONS.SWING.dteMin, HORIZONS.SWING.dteMax], [5, 30]);
  assert.deepEqual([HORIZONS.LEAPS.dteMin, HORIZONS.LEAPS.dteMax], [31, 90]);
  // no gap between adjacent lanes
  assert.equal(HORIZONS.SWING.dteMin, HORIZONS.ZERO_DTE.dteMax + 1);
  assert.equal(HORIZONS.LEAPS.dteMin, HORIZONS.SWING.dteMax + 1);
});

test("horizonForDte routes every boundary correctly", () => {
  assert.equal(horizonForDte(0), "ZERO_DTE");
  assert.equal(horizonForDte(1), "ZERO_DTE");
  assert.equal(horizonForDte(2), "ZERO_DTE");
  assert.equal(horizonForDte(3), "ZERO_DTE");
  assert.equal(horizonForDte(4), "ZERO_DTE");
  assert.equal(horizonForDte(5), "SWING");
  assert.equal(horizonForDte(30), "SWING");
  assert.equal(horizonForDte(31), "LEAPS");
  assert.equal(horizonForDte(90), "LEAPS");
});

test("horizonForDte returns null outside all lanes", () => {
  assert.equal(horizonForDte(91), null);
  assert.equal(horizonForDte(365), null);
  assert.equal(horizonForDte(-1), null);
  assert.equal(horizonForDte(NaN), null);
  assert.equal(horizonForDte(Infinity), null);
});

test("no DTE in [0,90] falls into more than one lane", () => {
  for (let dte = 0; dte <= 90; dte++) {
    const hits = HORIZON_ORDER.filter((id) => dteFitsHorizon(dte, id));
    assert.equal(hits.length, 1, `dte ${dte} should map to exactly one lane, got ${hits.join(",")}`);
  }
});

test("exit routing: 0DTE ratchets, Swing + LEAPS scale out", () => {
  assert.equal(exitPrimitiveFor("ZERO_DTE"), "RATCHET");
  assert.equal(exitPrimitiveFor("SWING"), "SCALE_OUT");
  assert.equal(exitPrimitiveFor("LEAPS"), "SCALE_OUT");
});

test("only the 0DTE floor is graduated; Swing/LEAPS floors are provisional", () => {
  assert.equal(HORIZONS.ZERO_DTE.scoreFloorGraduated, true);
  assert.equal(HORIZONS.ZERO_DTE.scoreFloor, 65); // the evidence-backed value
  assert.equal(HORIZONS.SWING.scoreFloorGraduated, false);
  assert.equal(HORIZONS.LEAPS.scoreFloorGraduated, false);
});

test("contract delta bands contain their target and are ordered", () => {
  for (const h of allHorizons()) {
    const [lo, hi] = h.contract.deltaBand;
    assert.ok(lo < hi, `${h.id} band must be ordered`);
    assert.ok(lo <= h.contract.targetDelta && h.contract.targetDelta <= hi, `${h.id} target within band`);
    assert.ok(lo > 0 && hi < 1, `${h.id} deltas are a fraction in (0,1)`);
  }
});

test("allHorizons returns the three lanes in fast→slow order", () => {
  assert.deepEqual(
    allHorizons().map((h) => h.id),
    ["ZERO_DTE", "SWING", "LEAPS"] satisfies Horizon[],
  );
});
