import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = [
  "nighthawk/hunt/route.ts",
  "nighthawk/legacy-marks/route.ts",
  "nighthawk/play-bars/route.ts",
  "largo/context/route.ts",
  "dark-pool/route.ts",
  "dark-pool/ticker/route.ts",
] as const;

const API_ROOT = join(process.cwd(), "src/app/api/market");

for (const rel of ROUTES) {
  test(`${rel} rounds member-visible floats at the API boundary`, () => {
    const src = readFileSync(join(API_ROOT, rel), "utf8");
    assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
    assert.match(src, /roundFloats\(/);
  });
}

test("stocks-spot-stream-hub rounds quote frames before SSE encode", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/ws/stocks-spot-stream-hub.ts"), "utf8");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /return roundFloats\(\{ type: "quotes", quotes, ts: now \}\)/);
});
