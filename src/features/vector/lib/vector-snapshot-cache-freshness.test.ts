import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/vector/lib/vector-snapshot.ts", "utf8");

test("vector-snapshot: wall/flip/dark-pool caches reject future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(s\.wallScope\.fetchedAt, refreshMs, now\)/);
  assert.match(src, /isWsUpdatedAtFresh\(s\.cachedWallsAt, WALLS_CACHE_MS, now\)/);
  assert.match(src, /isWsUpdatedAtFresh\(s\.cachedVexWallsAt, VEX_WALLS_CACHE_MS, now\)/);
  assert.match(src, /isWsUpdatedAtFresh\(s\.cachedFlipAt, FLIP_CACHE_MS, now\)/);
  assert.match(src, /!isWsUpdatedAtFresh\(s\.cachedFlipAt, FLIP_CACHE_MS\)/);
  assert.match(src, /!isWsUpdatedAtFresh\(s\.cachedDarkPoolAt, DARK_POOL_LOCAL_CACHE_MS\)/);
  assert.doesNotMatch(src, /now - s\.cachedWallsAt < WALLS_CACHE_MS/);
  assert.doesNotMatch(src, /now - s\.cachedVexWallsAt < VEX_WALLS_CACHE_MS/);
  assert.doesNotMatch(src, /now - s\.cachedFlipAt < FLIP_CACHE_MS/);
});
