import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = join(process.cwd(), "src/app/api/market/nighthawk/legacy-marks/route.ts");

test("legacy-marks route rounds member-visible floats at the API boundary", () => {
  const src = readFileSync(ROUTE, "utf8");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /roundFloats\(\{ available: true, marks \}\)/);
});
