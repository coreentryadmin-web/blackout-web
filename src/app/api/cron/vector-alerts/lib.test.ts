import { test } from "node:test";
import assert from "node:assert/strict";
import { distinctTickers, alertStateCacheKey, priorSpotCacheKey } from "./lib";

test("distinctTickers: de-dupes across multiple users sharing a ticker", () => {
  const out = distinctTickers([
    { user_id: "u1", ticker: "SPY" },
    { user_id: "u2", ticker: "SPY" },
    { user_id: "u1", ticker: "QQQ" },
  ]);
  assert.deepEqual(out, ["SPY", "QQQ"]);
});

test("distinctTickers: empty input yields empty output", () => {
  assert.deepEqual(distinctTickers([]), []);
});

test("alertStateCacheKey / priorSpotCacheKey: stable, distinct namespaces", () => {
  assert.equal(alertStateCacheKey("u1", "SPY"), "vector-alert-state:u1:SPY");
  assert.equal(priorSpotCacheKey("SPY"), "vector-alert-priorspot:SPY");
  // Different users on the same ticker must not collide on the state key (per-user state).
  assert.notEqual(alertStateCacheKey("u1", "SPY"), alertStateCacheKey("u2", "SPY"));
  // The prior-spot key is intentionally ticker-only (shared tape, not per-user).
  assert.equal(priorSpotCacheKey("SPY"), priorSpotCacheKey("SPY"));
});
