import { test } from "node:test";
import assert from "node:assert/strict";
import { isWsUpdatedAtFresh, wsUpdatedAtAgeMs } from "./timestamp-freshness";

test("wsUpdatedAtAgeMs clamps negative skew to 0", () => {
  const now = 1_000_000;
  assert.equal(wsUpdatedAtAgeMs(now + 2_000, now), 0);
  assert.equal(wsUpdatedAtAgeMs(now - 5_000, now), 5_000);
});

test("isWsUpdatedAtFresh rejects future timestamps beyond tolerance", () => {
  const now = 1_000_000;
  assert.equal(isWsUpdatedAtFresh(now + 6_000, 60_000, now), false);
  assert.equal(isWsUpdatedAtFresh(now + 4_000, 60_000, now), true);
  assert.equal(isWsUpdatedAtFresh(now - 30_000, 60_000, now), true);
  assert.equal(isWsUpdatedAtFresh(now - 90_000, 60_000, now), false);
});
