import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("clerk-user-cache: dedupe TTL uses isWsUpdatedAtFresh", () => {
  const src = readFileSync("src/lib/clerk-user-cache.ts", "utf8");
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(hit\.at, DEDUPE_TTL_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*hit\.at\s*</);
});

test("bie stage5-proposals: scan cache uses isWsUpdatedAtFresh", () => {
  const src = readFileSync("src/lib/bie/stage5-proposals.ts", "utf8");
  assert.match(src, /isWsUpdatedAtFresh\(cache\.at, CACHE_TTL_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*cache\.at\s*</);
});

test("x-marketing-meta: following cache uses isWsUpdatedAtFresh", () => {
  const src = readFileSync("src/lib/x-marketing-meta.ts", "utf8");
  assert.match(src, /isWsUpdatedAtFresh\(parsed\.at, FOLLOWING_CACHE_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*parsed\.at\s*</);
});
