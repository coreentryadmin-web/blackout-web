import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("POST /api/market/nighthawk/hunt", () => {
  test("roundFloats at the API boundary (source scan — sibling edition/horizons/play-bars routes already wrap)", () => {
    const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
    assert.match(src, /NextResponse\.json\(roundFloats\(response\)/);
  });
});
