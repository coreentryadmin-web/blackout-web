import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/market/dark-pool/ticker/route.ts", "utf8");

test("dark-pool ticker route rounds floats at the data layer", () => {
  assert.match(routeSrc, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(routeSrc, /NextResponse\.json\(roundFloats\(\{ snapshot, symbol \}\)/);
});
