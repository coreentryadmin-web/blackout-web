import { test } from "node:test";
import assert from "node:assert/strict";
import { isRegimeDegradedForCommit, regimeBandFor01 } from "./regime";

test("regimeBandFor01: coarse buckets, null → UNKNOWN", () => {
  assert.equal(regimeBandFor01(0.9), "RISK_ON");
  assert.equal(regimeBandFor01(0.5), "NEUTRAL");
  assert.equal(regimeBandFor01(0.1), "RISK_OFF");
  assert.equal(regimeBandFor01(null), "UNKNOWN");
});

test("isRegimeDegradedForCommit: blocks RISK_OFF and UNKNOWN; allows RISK_ON/NEUTRAL", () => {
  assert.equal(isRegimeDegradedForCommit(0.9), false);
  assert.equal(isRegimeDegradedForCommit(0.5), false);
  assert.equal(isRegimeDegradedForCommit(0.1), true);
  assert.equal(isRegimeDegradedForCommit(null), true);
});
