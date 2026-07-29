import assert from "node:assert/strict";
import test from "node:test";
import { applyVerificationCaveat } from "./turn-outcome";

test("applyVerificationCaveat: appends footer when coverage is low with 4+ claims", () => {
  const text = "SPX 6000, 6050, 6100, 6200 levels.";
  const out = applyVerificationCaveat(text, {
    total: 4,
    verified: 0,
    unverified: [6000, 6050, 6100, 6200],
    coverage: 0,
  });
  assert.match(out, /BIE verification/);
});

test("applyVerificationCaveat: leaves high-coverage answers unchanged", () => {
  const text = "SPX is at 5842.";
  const out = applyVerificationCaveat(text, {
    total: 1,
    verified: 1,
    unverified: [],
    coverage: 1,
  });
  assert.equal(out, text);
});
