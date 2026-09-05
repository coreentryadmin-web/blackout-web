import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = [
  "anomalies/route.ts",
  "nighthawk/legacy-marks/route.ts",
  "nighthawk/play-bars/route.ts",
] as const;

for (const rel of ROUTES) {
  test(`${rel} rounds member-visible floats at the API boundary`, () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/market", rel), "utf8");
    assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
    assert.match(src, /roundFloats\(/);
  });
}
