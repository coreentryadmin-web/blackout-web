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

test("tier-cache: eviction sweep also uses isWsUpdatedAtFresh (rejects future at)", () => {
  // setTierCache's size-pressure sweep is a second, independent call site with the
  // same raw-arithmetic bug: a far-future v.at never satisfies `now - v.at >= TTL`,
  // so a corrupted/clock-skewed entry is never swept (only evicted incidentally
  // once MAX_TIER_CACHE forces oldest-key deletion).
  assert.match(src, /isWsUpdatedAtFresh\(v\.at, TIER_CACHE_TTL_MS, now\)/);
  assert.doesNotMatch(src, /now\s*-\s*v\.at\s*>=\s*TIER_CACHE_TTL_MS/);
});
