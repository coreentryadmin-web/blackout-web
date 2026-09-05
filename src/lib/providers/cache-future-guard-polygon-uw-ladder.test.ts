import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const polygonSrc = readFileSync("src/lib/providers/polygon.ts", "utf8");
const ladderSrc = readFileSync("src/lib/providers/spx-odte-uw-ladder.ts", "utf8");

test("fetchVixIvRankPercentile in-process cache rejects future at stamps", () => {
  assert.match(polygonSrc, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(polygonSrc, /isWsUpdatedAtFresh\(cachedVixIvRank\.at, 300_000, now\)/);
  assert.doesNotMatch(polygonSrc, /now - cachedVixIvRank\.at < 300_000/);
});

test("getSpxOdteScopedUwLadderMap in-process cache rejects future at stamps", () => {
  assert.match(ladderSrc, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(ladderSrc, /isWsUpdatedAtFresh\(cachedScoped\.at, scopedLadderCacheMs\(\), now\)/);
  assert.doesNotMatch(ladderSrc, /now - cachedScoped\.at < scopedLadderCacheMs\(\)/);
});
