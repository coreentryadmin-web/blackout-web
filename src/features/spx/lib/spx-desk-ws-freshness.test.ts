/**
 * Regression: UW WS store freshness in spx-desk must guard future `updatedAt` timestamps.
 * Run: `npx tsx --test src/features/spx/lib/spx-desk-ws-freshness.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-desk.ts", "utf8");

test("spx-desk: UW WS freshness uses shared isWsUpdatedAtFresh, not raw Date.now() - updatedAt", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /function uwWsStoreFresh\(/);
  assert.match(src, /return isWsUpdatedAtFresh\(updatedAt, staleMs, now\)/);
  assert.match(src, /uwWsStoreFresh\(tideStore\.updatedAt, TIDE_STALE_MS\)/);
  assert.match(src, /uwWsStoreFresh\(snap\.updatedAt, INTERVAL_FLOW_WS_STALE_MS\)/);
  assert.match(src, /uwWsStoreFresh\(darkPoolStore\.updatedAt, DARK_POOL_WS_STALE_MS\)/);
  assert.doesNotMatch(
    src,
    /if \(Date\.now\(\) - tideStore\.updatedAt < TIDE_STALE_MS\)/,
    "must not use unguarded tide freshness"
  );
});

test("spx-desk: index WS freshness guards future updatedAt via indexWsFresh", () => {
  assert.match(src, /function indexWsFresh\(/);
  assert.match(src, /indexWsFresh\(ws\.updatedAt, now\)/);
  assert.match(src, /indexWsFresh\(e\.updatedAt, now\)/);
});
