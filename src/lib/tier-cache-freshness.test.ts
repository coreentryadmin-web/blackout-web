import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/tier-cache.ts", "utf8");

test("tier-cache: TTL and stale-max use isWsUpdatedAtFresh (rejects future at)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, TIER_CACHE_TTL_MS\)/);
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, TIER_STALE_MAX_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*cached\.at\s*</);
});

test("tier-cache: eviction sweep uses isWsUpdatedAtFresh (rejects future at)", () => {
  assert.match(src, /isWsUpdatedAtFresh\(v\.at, TIER_CACHE_TTL_MS, now\)/);
  assert.doesNotMatch(src, /now\s*-\s*v\.at\s*>=\s*TIER_CACHE_TTL_MS/);
});
