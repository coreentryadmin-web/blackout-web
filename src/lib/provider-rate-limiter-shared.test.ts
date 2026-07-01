import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDegradedLocalRps } from "./providers/provider-rate-limiter-shared";

test("computeDegradedLocalRps divides global budget across replicas", () => {
  assert.equal(computeDegradedLocalRps(2, 1), 2);
  assert.equal(computeDegradedLocalRps(2, 2), 1);
  assert.ok(Math.abs(3 * computeDegradedLocalRps(2, 3) - 2) < 1e-9);
});
