import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/tier-cache.ts", "utf8");

test("tier-cache: fast path rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, TIER_CACHE_TTL_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\) - cached\.at < TIER_CACHE_TTL_MS/);
});

test("tier-cache: stale fallback rejects future at stamps", () => {
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, TIER_STALE_MAX_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\) - cached\.at < TIER_STALE_MAX_MS/);
});
