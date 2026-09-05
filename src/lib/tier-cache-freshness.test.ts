import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("tier-cache resolveUserTier uses isWsUpdatedAtFresh for hot and stale paths", () => {
  const src = readFileSync("src/lib/tier-cache.ts", "utf8");
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, TIER_CACHE_TTL_MS/);
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, TIER_STALE_MAX_MS/);
  assert.doesNotMatch(
    src,
    /Date\.now\(\) - cached\.at < TIER_/,
    "raw Date.now()-at TTL must not remain — future-skewed at reads as infinitely fresh"
  );
});
