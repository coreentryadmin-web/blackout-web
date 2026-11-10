import assert from "node:assert/strict";
import test from "node:test";

import { shouldSkipGexColdDuringRth } from "./data-integrity-checks-eval";

test("shouldSkipGexColdDuringRth: skip cold-matrix P0 when Polygon circuit is open", () => {
  assert.equal(shouldSkipGexColdDuringRth(true, true), true);
  assert.equal(shouldSkipGexColdDuringRth(true, false), false);
  assert.equal(shouldSkipGexColdDuringRth(false, true), false);
});
