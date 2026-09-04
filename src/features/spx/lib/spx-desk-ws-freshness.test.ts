/**
 * Regression: UW WS store freshness in spx-desk must guard future `updatedAt` timestamps.
 * Run: `npx tsx --test src/features/spx/lib/spx-desk-ws-freshness.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-desk.ts", "utf8");

test("spx-desk: UW WS freshness uses a future-tolerance guard, not raw Date.now() - updatedAt", () => {
  assert.match(src, /function uwWsStoreFresh\(/);
  assert.match(src, /UW_WS_FUTURE_TOLERANCE_MS/);
  assert.match(src, /ageMs >= -UW_WS_FUTURE_TOLERANCE_MS && Math\.max\(0, ageMs\) < staleMs/);
  assert.match(src, /uwWsStoreFresh\(tideStore\.updatedAt, TIDE_STALE_MS\)/);
  assert.match(src, /uwWsStoreFresh\(snap\.updatedAt, INTERVAL_FLOW_WS_STALE_MS\)/);
  assert.match(src, /uwWsStoreFresh\(darkPoolStore\.updatedAt, DARK_POOL_WS_STALE_MS\)/);
  assert.doesNotMatch(
    src,
    /if \(Date\.now\(\) - tideStore\.updatedAt < TIDE_STALE_MS\)/,
    "must not use unguarded tide freshness"
  );
});
