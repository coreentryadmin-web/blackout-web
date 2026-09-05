import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/largo/spx-desk-cache.ts", "utf8");

test("largo spx-desk-cache: bundle TTL rejects future cachedAt stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(existing\.cachedAt, CACHE_TTL_MS, now\)/);
  assert.doesNotMatch(src, /now - existing\.cachedAt <= CACHE_TTL_MS/);
});
