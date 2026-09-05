import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/market/health/route.ts", "utf8");

test("market/health: admin snapshot is rounded at the JSON boundary", () => {
  assert.match(routeSrc, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(routeSrc, /NextResponse\.json\(roundFloats\(snapshot\)/);
});
