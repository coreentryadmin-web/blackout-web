import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/providers/spot-fallback.ts", "utf8");

test("resolveSpotFromUwStockState in-process cache rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(hit\.at, MEM_TTL_MS, now\)/);
  assert.doesNotMatch(src, /now - hit\.at < MEM_TTL_MS/);
});
