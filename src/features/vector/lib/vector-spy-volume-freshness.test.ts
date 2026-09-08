import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/vector/lib/vector-spy-volume.ts", "utf8");

test("vector-spy-volume: in-process caches reject future fetchedAt stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cache\.fetchedAt, CACHE_MS, nowMs\)/);
  assert.match(src, /isWsUpdatedAtFresh\(dayBars\.fetchedAt, DAY_BARS_CACHE_MS, nowMs\)/);
  assert.doesNotMatch(src, /nowMs - cache\.fetchedAt < CACHE_MS/);
  assert.doesNotMatch(src, /nowMs - dayBars\.fetchedAt >= DAY_BARS_CACHE_MS/);
});
