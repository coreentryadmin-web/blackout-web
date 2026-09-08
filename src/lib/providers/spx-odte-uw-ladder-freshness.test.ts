import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/providers/spx-odte-uw-ladder.ts", "utf8");

test("getSpxOdteScopedUwLadderMap in-process cache rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cachedScoped\.at, scopedLadderCacheMs\(\), now\)/);
  assert.doesNotMatch(src, /now - cachedScoped\.at < scopedLadderCacheMs\(\)/);
});
