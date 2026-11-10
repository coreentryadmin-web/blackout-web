import assert from "node:assert/strict";
import test from "node:test";

import { shouldFlagGexColdDuringRth } from "./data-integrity-gex-freshness";

test("shouldFlagGexColdDuringRth: cold matrix during RTH is flagged when circuit is closed", () => {
  assert.equal(shouldFlagGexColdDuringRth(null, false), true);
});

test("shouldFlagGexColdDuringRth: null read while circuit open is not flagged (transient blip)", () => {
  assert.equal(shouldFlagGexColdDuringRth(null, true), false);
});

test("shouldFlagGexColdDuringRth: present matrix never flagged", () => {
  assert.equal(shouldFlagGexColdDuringRth({ spot: 1 }, false), false);
  assert.equal(shouldFlagGexColdDuringRth({ spot: 1 }, true), false);
});
