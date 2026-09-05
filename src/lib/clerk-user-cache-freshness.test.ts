import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/clerk-user-cache.ts", "utf8");

test("clerk-user-cache: dedupe TTL uses isWsUpdatedAtFresh (rejects future at)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(hit\.at, DEDUPE_TTL_MS\)/);
  assert.match(src, /isWsUpdatedAtFresh\(v\.at, DEDUPE_TTL_MS, now\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*hit\.at\s*</);
  assert.doesNotMatch(src, /now\s*-\s*v\.at\s*>=\s*DEDUPE_TTL_MS/);
});
