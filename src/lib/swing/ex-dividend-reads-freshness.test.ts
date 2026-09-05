import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/swing/ex-dividend-reads.ts", "utf8");

test("ex-dividend-reads: cache TTL uses isWsUpdatedAtFresh (rejects future at)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(hit\.at, CACHE_TTL_MS\)/);
  assert.doesNotMatch(src, /now\s*-\s*hit\.at\s*</);
});
