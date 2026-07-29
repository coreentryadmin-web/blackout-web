import assert from "node:assert/strict";
import test from "node:test";
import { applyVerificationCaveat } from "./turn-outcome";

test("applyVerificationCaveat: appends BIE footer when coverage < 50% with 4+ claims", () => {
  const text = "SPX at 6000, call wall 6050, targets 6100, 6200.";
  const out = applyVerificationCaveat(text, {
    total: 4,
    verified: 0,
    unverified: [6000, 6050, 6100, 6200],
    coverage: 0,
  });
  assert.match(out, /BIE verification/);
  assert.match(out, /4 of 4 figures/);
});

test("applyVerificationCaveat: leaves high-coverage answers unchanged", () => {
  const text = "SPX at 5900 with IV rank 47%.";
  const out = applyVerificationCaveat(text, {
    total: 2,
    verified: 2,
    unverified: [],
    coverage: 1,
  });
  assert.equal(out, text);
});
