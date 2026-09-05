import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/providers/unusual-whales.ts", "utf8");

test("unusual-whales: marketFlowCache hot path rejects future cachedAt stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(
    src,
    /isWsUpdatedAtFresh\(marketFlowCache\.cachedAt, marketFlowCacheMs\(\), now\)/
  );
  assert.doesNotMatch(src, /marketFlowCache\.expiresAt > now/);
});

test("unusual-whales: marketFlowCache stale fallback rejects future cachedAt stamps", () => {
  assert.match(
    src,
    /isWsUpdatedAtFresh\(marketFlowCache\.cachedAt, MARKET_FLOW_MAX_STALE_MS, now\)/
  );
  assert.doesNotMatch(src, /now - marketFlowCache\.cachedAt <= MARKET_FLOW_MAX_STALE_MS/);
});
