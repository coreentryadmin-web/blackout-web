import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-vwap-proxy.ts", "utf8");

test("spx-vwap-proxy: SPY volume cache rejects future fetchedAt stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cache\.fetchedAt, ttl, now\)/);
  assert.doesNotMatch(src, /now - cache\.fetchedAt < ttl/);
});
