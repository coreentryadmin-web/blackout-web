import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("getIndexStoreStatus delegates symbol age to getIndexFeedFreshness (future-skew guard)", () => {
  const src = readFileSync(new URL("./polygon-socket.ts", import.meta.url), "utf8");
  assert.match(src, /getIndexFeedFreshness\(sym\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*indexStore\[sym\]\.updatedAt/);
});
