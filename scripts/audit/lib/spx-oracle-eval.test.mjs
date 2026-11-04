import test from "node:test";
import assert from "node:assert/strict";
import {
  offHoursUsesSessionClose,
  spxOracleVerdict,
} from "./spx-oracle-eval.mjs";

test("offHoursUsesSessionClose: true after 4 PM ET on a trading day", () => {
  assert.equal(offHoursUsesSessionClose(new Date("2026-11-04T21:02:00.000Z")), true);
});

test("offHoursUsesSessionClose: false pre-open same day", () => {
  assert.equal(offHoursUsesSessionClose(new Date("2026-11-04T13:30:00.000Z")), false);
});

test("spxOracleVerdict: post-close same-day move vs stale /prev (RTH audit 2026-11-04 false P0)", () => {
  const desk = 7683.82;
  const sessionClose = 7683.5;
  const stalePrev = 7568.92;
  assert.equal(spxOracleVerdict(desk, stalePrev, false).verdict, "fail");
  assert.equal(spxOracleVerdict(desk, sessionClose, false).verdict, "pass");
});

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
