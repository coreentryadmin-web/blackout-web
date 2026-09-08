import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("GET /api/market/anomalies", () => {
  test("roundFloats at the API boundary", () => {
    const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
    assert.match(src, /NextResponse\.json\(\s*roundFloats\(/);
  });
});
