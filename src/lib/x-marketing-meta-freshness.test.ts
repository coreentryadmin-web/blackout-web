import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/x-marketing-meta.ts", "utf8");

test("x-marketing-meta: following cache TTL uses isWsUpdatedAtFresh (rejects future at)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(parsed\.at, FOLLOWING_CACHE_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*parsed\.at\s*</);
});
