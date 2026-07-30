import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("vector stream route defaults missing ticker to SPX instead of 400", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../app/api/market/vector/stream/route.ts"),
    "utf8"
  );
  assert.match(src, /normalizeVectorTicker\(rawTicker\)/);
  assert.doesNotMatch(src, /if\s*\(\s*!isVectorTickerAllowed\(rawTicker\)\s*\)/);
});

test("web-boot-warm awaits priming before ready returns and warms vector hub", () => {
  const warm = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../lib/web-boot-warm.ts"),
    "utf8"
  );
  const ready = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../app/api/ready/route.ts"),
    "utf8"
  );
  assert.match(warm, /awaitWebBootWarm/);
  assert.match(warm, /warmVectorStreamHub/);
  assert.match(ready, /await awaitWebBootWarm/);
});
