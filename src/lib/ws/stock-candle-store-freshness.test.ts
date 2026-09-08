import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/ws/stock-candle-store.ts", "utf8");

test("stock-candle-store: Redis fallback refresh rejects future fetchedAt stamps", () => {
  assert.match(src, /isWsUpdatedAtFresh\(f\.fetchedAt, REDIS_READ_REFRESH_MS, now\)/);
  assert.doesNotMatch(src, /now - f\.fetchedAt < REDIS_READ_REFRESH_MS/);
});
