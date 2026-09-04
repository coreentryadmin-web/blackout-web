import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("legacy-marks/route.ts rounds member-visible floats at the API boundary", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/market/nighthawk/legacy-marks/route.ts"),
    "utf8"
  );
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /roundFloats\(\{ available: true, marks \}\)/);
});
