import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSpxOracleAgreement } from "./spx-oracle-eval.mjs";

test("evaluateSpxOracleAgreement: off-hours 11pt gap on ~7541 passes (RTH deep audit 2026-11-02 false P0)", () => {
  const r = evaluateSpxOracleAgreement(7552.74, 7541.4, false);
  assert.equal(r.ok, true);
  assert.ok(r.pct < 1.5);
});

test("evaluateSpxOracleAgreement: RTH rejects large relative drift", () => {
  const r = evaluateSpxOracleAgreement(7600, 7541.4, true);
  assert.equal(r.ok, false);
  assert.ok(r.pct > 0.3);
});
