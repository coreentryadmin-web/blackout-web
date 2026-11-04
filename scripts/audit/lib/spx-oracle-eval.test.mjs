import test from "node:test";
import assert from "node:assert/strict";
import { spxOracleVerdict, pickOffHoursSpxOracleGroundTruth } from "./spx-oracle-eval.mjs";

test("spxOracleVerdict: off-hours allows sub-1.5% drift (RTH deep audit 2026-11-02 false P0)", () => {
  const desk = 7552.74;
  const prevClose = 7541.4;
  const v = spxOracleVerdict(desk, prevClose, false);
  assert.equal(v.verdict, "pass");
  assert.ok(v.pct != null && v.pct < 1.5);
});

test("spxOracleVerdict: RTH uses tighter 0.3% tolerance", () => {
  const desk = 7550;
  const live = 7550 + 25; // ~0.33%
  assert.equal(spxOracleVerdict(desk, live, true).verdict, "fail");
  assert.equal(spxOracleVerdict(desk, live - 5, true).verdict, "pass");
});

test("spxOracleVerdict: skip when inputs missing", () => {
  assert.equal(spxOracleVerdict(null, 100, true).verdict, "skip");
  assert.equal(spxOracleVerdict(100, 0, true).verdict, "skip");
});

test("pickOffHoursSpxOracleGroundTruth prefers session close over /prev (2026-11-04 RTH audit)", () => {
  const desk = 7683.82;
  const prevClose = 7568.92;
  const sessionClose = 7683.5;
  const picked = pickOffHoursSpxOracleGroundTruth(sessionClose, prevClose);
  assert.equal(picked.label, "session-close");
  assert.equal(spxOracleVerdict(desk, picked.oracle, false).verdict, "pass");
  assert.equal(spxOracleVerdict(desk, prevClose, false).verdict, "fail");
});
