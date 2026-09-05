import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/vector/lib/vector-snapshot.ts", "utf8");

test("vector-snapshot: wallScope TTL rejects future fetchedAt stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(s\.wallScope\.fetchedAt, refreshMs, now\)/);
  assert.doesNotMatch(src, /now - s\.wallScope\.fetchedAt < refreshMs/);
});

test("vector-snapshot: gamma-wall memo rejects future cachedWallsAt stamps", () => {
  assert.match(src, /isWsUpdatedAtFresh\(s\.cachedWallsAt, WALLS_CACHE_MS, now\)/);
  assert.doesNotMatch(src, /now - s\.cachedWallsAt < WALLS_CACHE_MS/);
});

test("vector-snapshot: vex-wall memo rejects future cachedVexWallsAt stamps", () => {
  assert.match(src, /isWsUpdatedAtFresh\(s\.cachedVexWallsAt, VEX_WALLS_CACHE_MS, now\)/);
  assert.doesNotMatch(src, /now - s\.cachedVexWallsAt < VEX_WALLS_CACHE_MS/);
});

test("vector-snapshot: gamma-flip memo rejects future cachedFlipAt stamps", () => {
  assert.match(src, /isWsUpdatedAtFresh\(s\.cachedFlipAt, FLIP_CACHE_MS, now\)/);
  assert.doesNotMatch(src, /now - s\.cachedFlipAt < FLIP_CACHE_MS/);
  assert.match(src, /!isWsUpdatedAtFresh\(s\.cachedFlipAt, FLIP_CACHE_MS, Date\.now\(\)\)/);
});
