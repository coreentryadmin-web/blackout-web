import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/lib/providers/unusual-whales.ts"), "utf8");

test("readUwCache rejects far-future fetchedAt (source scan)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(
    src,
    /function readUwCache[\s\S]*?isWsUpdatedAtFresh\(slot\.fetchedAt, ttl\)/,
    "in-process UW REST cache must not treat clock-skewed future fetchedAt as fresh"
  );
});

test("marketFlowCache 429 fallback rejects future cachedAt (source scan)", () => {
  assert.match(
    src,
    /isWsUpdatedAtFresh\(marketFlowCache\.cachedAt, MARKET_FLOW_MAX_STALE_MS, now\)/,
    "429 fallback must not serve flow-alerts cache with clock-skewed future cachedAt"
  );
  assert.doesNotMatch(src, /now - marketFlowCache\.cachedAt <= MARKET_FLOW_MAX_STALE_MS/);
});
