import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("bie stage5-proposals: scan cache uses isWsUpdatedAtFresh (rejects future at)", () => {
  const src = readFileSync("src/lib/bie/stage5-proposals.ts", "utf8");
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cache\.at, CACHE_TTL_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*cache\.at\s*</);
});
