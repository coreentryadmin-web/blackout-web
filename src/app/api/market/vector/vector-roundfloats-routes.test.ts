import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = [
  "universe/route.ts",
  "wall-history/route.ts",
  "daily-regime/route.ts",
  "rail-bootstrap/route.ts",
  "contract-picks/route.ts",
  "contract-picks/live/route.ts",
] as const;

for (const rel of ROUTES) {
  test(`${rel} rounds member-visible floats at the API boundary`, () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/market/vector", rel), "utf8");
    assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
    assert.match(src, /roundFloats\(/);
  });
}
