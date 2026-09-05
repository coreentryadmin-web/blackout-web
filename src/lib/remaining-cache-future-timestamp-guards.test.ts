import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("clerk-user-cache: eviction sweep uses isWsUpdatedAtFresh", () => {
  const src = readFileSync("src/lib/clerk-user-cache.ts", "utf8");
  assert.match(src, /isWsUpdatedAtFresh\(v\.at, DEDUPE_TTL_MS, now\)/);
  assert.doesNotMatch(src, /now\s*-\s*v\.at\s*>=\s*DEDUPE_TTL_MS/);
});

test("bie stage5-proposals: scan cache uses isWsUpdatedAtFresh", () => {
  const src = readFileSync("src/lib/bie/stage5-proposals.ts", "utf8");
  assert.match(src, /isWsUpdatedAtFresh\(cache\.at, CACHE_TTL_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*cache\.at\s*</);
});
