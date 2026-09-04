import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/vector/lib/vector-snapshot.ts", "utf8");

test("getVectorGexWalls: returns null walls when spot is not yet grounded", () => {
  assert.match(
    src,
    /if \(!spot\) \{\s*\n\s*s\.cachedWalls = null;\s*\n\s*s\.cachedWallsAt = now;\s*\n\s*return null;\s*\n\s*\}/
  );
});

test("getVectorGexWallsForHorizon WS fallback: requires spot before side-constrained walls", () => {
  assert.match(src, /if \(!spot\) return getVectorGexWalls\(t\);/);
});
