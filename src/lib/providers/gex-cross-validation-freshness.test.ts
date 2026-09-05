import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("gex-cross-validation in-memory ladder cache uses isWsUpdatedAtFresh", () => {
  const src = readFileSync("src/lib/providers/gex-cross-validation.ts", "utf8");
  const fn = src.slice(src.indexOf("async function getUwStrikeLadder"), src.indexOf("if (isUwChannelFresh"));
  assert.match(fn, /isWsUpdatedAtFresh\(entry\.cachedAt, CACHE_TTL_MS/);
  assert.doesNotMatch(fn, /Date\.now\(\) - entry\.cachedAt < CACHE_TTL_MS/);
});
