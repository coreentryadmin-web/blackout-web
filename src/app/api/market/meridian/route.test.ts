import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/app/api/market/meridian");

test("meridian timeline route is premium + tool gated with server cache", () => {
  const src = readFileSync(join(root, "timeline/route.ts"), "utf8");
  assert.match(src, /authorizePremiumDeskApi/);
  assert.match(src, /requireToolApi\("meridian"\)/);
  assert.match(src, /serverCache/);
  assert.doesNotMatch(src, /requireAdminApi/);
});

test("meridian event route is premium + tool gated with server cache", () => {
  const src = readFileSync(join(root, "event/route.ts"), "utf8");
  assert.match(src, /authorizePremiumDeskApi/);
  assert.match(src, /requireToolApi\("meridian"\)/);
  assert.match(src, /serverCache/);
  assert.doesNotMatch(src, /requireAdminApi/);
});
