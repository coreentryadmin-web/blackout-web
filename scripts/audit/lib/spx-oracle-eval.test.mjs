import test from "node:test";
import assert from "node:assert/strict";
import { spxOracleVerdict } from "./spx-oracle-eval.mjs";

test("spxOracleVerdict: off-hours prior_close vs Polygon prev (0.05% tol)", () => {
  const deskPdc = 7568.92;
  const polyPrev = 7568.5;
  const v = spxOracleVerdict(deskPdc, polyPrev, false);
  assert.equal(v.verdict, "pass");
  assert.equal(v.tolPct, 0.05);
});

test("spxOracleVerdict: off-hours session price vs prev is not the oracle (would false-fail big days)", () => {
  const sessionPrice = 7683.82;
  const polyPrev = 7568.92;
  const v = spxOracleVerdict(sessionPrice, polyPrev, false);
  assert.equal(v.verdict, "fail");
  assert.ok(v.pct != null && v.pct > 1.5);
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
