import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/providers/polygon.ts", "utf8");

test("fetchVixIvRankPercentile in-process cache rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cachedVixIvRank\.at, 300_000, now\)/);
  assert.doesNotMatch(src, /now - cachedVixIvRank\.at < 300_000/);
});

test("fetchMarketStatusNow in-process cache rejects future at stamps", () => {
  assert.match(src, /isWsUpdatedAtFresh\(marketStatusCache\.fetchedAt, MARKET_STATUS_CACHE_MS, now\)/);
  assert.doesNotMatch(src, /Date\.now\(\) - marketStatusCache\.fetchedAt < MARKET_STATUS_CACHE_MS/);
});
