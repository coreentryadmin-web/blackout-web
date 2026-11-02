import test from "node:test";
import assert from "node:assert/strict";
import {
  pickSpxOracleFromPolygon,
  spxOracleWithinTolerance,
} from "./full-site-spx-oracle.mjs";

test("pickSpxOracleFromPolygon: RTH uses snapshot live value", () => {
  const picked = pickSpxOracleFromPolygon({
    isRth: true,
    snapshotValue: 7550,
    snapshotSessionClose: 7540,
    todayDayClose: 7552,
    prevDayClose: 7541,
  });
  assert.deepEqual(picked, { oracle: 7550, label: "live" });
});

test("pickSpxOracleFromPolygon: off-hours prefers today's daily close over snapshot session.close", () => {
  const picked = pickSpxOracleFromPolygon({
    isRth: false,
    snapshotValue: 7541.4,
    snapshotSessionClose: 7541.4,
    todayDayClose: 7552.74,
    prevDayClose: 7541.4,
  });
  assert.deepEqual(picked, { oracle: 7552.74, label: "today-close" });
});

test("spxOracleWithinTolerance: an 11pt session mismatch fails under RTH tolerance", () => {
  const desk = 7552.74;
  const wrongOracle = 7541.4;
  assert.equal(spxOracleWithinTolerance(desk, wrongOracle, true).ok, false);
  assert.equal(spxOracleWithinTolerance(desk, desk, false).ok, true);
});
