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

const ROUND_FLOAT_ROUTES = [
  "event/route.ts",
  "timeline/route.ts",
  "lookup/route.ts",
  "peer-reactions/route.ts",
] as const;

for (const rel of ROUND_FLOAT_ROUTES) {
  test(`${rel} rounds member-visible floats at the API boundary`, () => {
    const src = readFileSync(join(root, rel), "utf8");
    assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
    assert.match(src, /NextResponse\.json\(\s*roundFloats\(/);
  });
}
