import test from "node:test";
import assert from "node:assert/strict";
import { polygonMarketOpen, spxOracleVerdict } from "./spx-oracle-audit.mjs";

test("spxOracleVerdict: off-hours 11pt gap on ~7541 passes at 1.5% tolerance", () => {
  const v = spxOracleVerdict(7552.74, 7541.4, false);
  assert.equal(v.ok, true);
});

test("spxOracleVerdict: RTH enforces tight 0.3% band", () => {
  const ref = 7500;
  const desk = ref * 1.004; // 0.4%
  assert.equal(spxOracleVerdict(desk, ref, true).ok, false);
  assert.equal(spxOracleVerdict(ref * 1.002, ref, true).ok, true);
});

test("polygonMarketOpen reads Polygon marketstatus", () => {
  assert.equal(polygonMarketOpen({ market: "open" }), true);
  assert.equal(polygonMarketOpen({ market: "closed" }), false);
});
