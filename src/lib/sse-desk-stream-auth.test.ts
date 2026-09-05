import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

test("zerodte marks SSE re-checks tier/tool on every tick", () => {
  const src = readFileSync(
    join(root, "app/api/market/zerodte/marks/stream/route.ts"),
    "utf8"
  );
  assert.match(src, /recheckUserSseDeskAccess/);
  assert.doesNotMatch(
    src,
    /requireToolApi\("nighthawk"\)[\s\S]*setInterval/,
    "tool gate must not be connect-only before setInterval"
  );
});

test("vector SSE re-checks tier/tool on every tick", () => {
  const src = readFileSync(join(root, "app/api/market/vector/stream/route.ts"), "utf8");
  assert.match(src, /recheckUserSseDeskAccess/);
});
