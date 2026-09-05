import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("recheckSseUserEntitlement re-runs tier + optional tool gate", () => {
  const src = readFileSync(join(root, "src/lib/sse-stream-entitlement.ts"), "utf8");
  assert.match(src, /requireTierApi/);
  assert.match(src, /requireToolApi/);
});

test("zerodte marks stream rechecks entitlement on every user tick", () => {
  const src = readFileSync(
    join(root, "src/app/api/market/zerodte/marks/stream/route.ts"),
    "utf8",
  );
  assert.match(src, /recheckSseUserEntitlement\("premium", "nighthawk"\)/);
  assert.match(src, /isUserStream/);
});

test("vector stream rechecks entitlement on every user tick", () => {
  const src = readFileSync(join(root, "src/app/api/market/vector/stream/route.ts"), "utf8");
  assert.match(src, /recheckSseUserEntitlement\("premium", "vector"\)/);
  assert.match(src, /isUserStream/);
});
