import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/market/anomalies/route.ts", "utf8");

test("anomalies route rounds floats at the data layer", () => {
  assert.match(routeSrc, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(routeSrc, /NextResponse\.json\(roundFloats\(\{/);
});
