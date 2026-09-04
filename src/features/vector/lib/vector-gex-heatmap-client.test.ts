import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/vector/lib/vector-gex-heatmap-client.ts", "utf8");

test("vector gex heatmap client dedupe cache clamps negative age from clock skew", () => {
  assert.match(src, /function clientCacheAgeMs\(/);
  assert.match(src, /Math\.max\(0, now - cachedAt\)/);
  assert.match(src, /clientCacheAgeMs\(hit\.at\) < CACHE_MS/);
  assert.doesNotMatch(src, /Date\.now\(\) - hit\.at < CACHE_MS/);
});
