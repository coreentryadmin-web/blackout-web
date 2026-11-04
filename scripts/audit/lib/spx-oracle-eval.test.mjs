import test from "node:test";
import assert from "node:assert/strict";
import { resolveOracleUsesLiveRth, spxOracleVerdict } from "./spx-oracle-eval.mjs";

test("resolveOracleUsesLiveRth: ET RTH window uses live oracle when Polygon marketstatus missing", () => {
  assert.equal(resolveOracleUsesLiveRth(null, true), true);
  assert.equal(resolveOracleUsesLiveRth(false, true), true);
  assert.equal(resolveOracleUsesLiveRth(true, false), true);
  assert.equal(resolveOracleUsesLiveRth(false, false), false);
});

test("REGRESSION 2026-11-04 RTH audit: live desk vs prev-close must not use off-hours 1.5% path during ET RTH", () => {
  const desk = 7683.82;
  const prevClose = 7568.92;
  assert.equal(spxOracleVerdict(desk, prevClose, false).verdict, "fail");
  assert.ok(resolveOracleUsesLiveRth(null, true));
  assert.equal(spxOracleVerdict(desk, desk + 1, true).verdict, "pass");
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
