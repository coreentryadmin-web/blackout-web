import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("legacy-marks: roundFloats at the API boundary (source scan — sibling edition/horizons/play-bars wrap)", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(
    src,
    /NextResponse\.json\(roundFloats\(\{ available: true, marks \}\)/
  );
});
