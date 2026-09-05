import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/vector/lib/vector-wall-write.ts", "utf8");

test("vector-wall-write: persist debounce rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(last\.at, 2_000, now\)/);
  assert.doesNotMatch(src, /now - last\.at < 2_000/);
});
