import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/providers/gex-cross-validation.ts", "utf8");

test("gex-cross-validation: UW ladder cache rejects future cachedAt stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(entry\.cachedAt, CACHE_TTL_MS, now\)/);
  assert.doesNotMatch(src, /Date\.now\(\) - entry\.cachedAt < CACHE_TTL_MS/);
});
