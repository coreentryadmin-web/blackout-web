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
  "play-bie/route.ts",
  "spy-volume/route.ts",
] as const;

for (const rel of ROUTES) {
  test(`${rel} rounds member-visible floats at the API boundary`, () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/market/vector", rel), "utf8");
    assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
    assert.match(src, /roundFloats\(/);
  });
}

test("contract-picks/live/route.ts applies greek-precision keyDp (gamma must not flatten to 2dp)", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/market/vector/contract-picks/live/route.ts"),
    "utf8"
  );
  assert.match(
    src,
    /import \{ VECTOR_PICK_LIVE_WIRE_DP \} from "@\/features\/vector\/lib\/vector-response-rounding"/
  );
  assert.match(
    src,
    /roundFloats\(\s*\{[\s\S]*?\},\s*2,\s*VECTOR_PICK_LIVE_WIRE_DP\s*\)/,
    "must pass VECTOR_PICK_LIVE_WIRE_DP as keyDp — a flat default dp=2 quantizes live 0DTE gamma (~0.0008) to 0.00"
  );
});
