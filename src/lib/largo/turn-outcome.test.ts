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
  // Assert on what the caveat must TELL THE MEMBER — how many figures could not be traced —
  // not on the label. The label was "BIE verification" until BIE was removed from Largo; a
  // member-facing string should never have carried an internal subsystem's name in the first
  // place, and pinning the test to it would make renaming it look like a regression.
  assert.match(out, /4 of 4 figures/);
  assert.match(out, /could not be traced/);
  assert.doesNotMatch(out, /BIE/, "member-facing text must not name internal subsystems");
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
