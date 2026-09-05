import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("recheckSseUserEntitlement omits session JWT claims on tier recheck", () => {
  const src = readFileSync(join(root, "src/lib/sse-stream-entitlement.ts"), "utf8");
  assert.match(src, /resolveUserTier\(ctx\.userId\)/);
  assert.doesNotMatch(src, /sessionClaims/);
});

test("zerodte marks stream rechecks entitlement on every user tick", () => {
  const src = readFileSync(
    join(root, "src/app/api/market/zerodte/marks/stream/route.ts"),
    "utf8",
  );
  assert.match(src, /recheckSseUserEntitlement\(\{/);
  assert.match(src, /tool: "nighthawk"/);
  assert.match(src, /streamUserId/);
});

test("vector stream rechecks entitlement on every user tick", () => {
  const src = readFileSync(join(root, "src/app/api/market/vector/stream/route.ts"), "utf8");
  assert.match(src, /recheckSseUserEntitlement\(\{/);
  assert.match(src, /tool: "vector"/);
  assert.match(src, /streamUserId/);
});

test("flows stream rechecks entitlement on every user send", () => {
  const src = readFileSync(join(root, "src/app/api/market/flows/stream/route.ts"), "utf8");
  assert.match(src, /recheckSseUserEntitlement\(\{/);
  assert.match(src, /streamUserId/);
});
