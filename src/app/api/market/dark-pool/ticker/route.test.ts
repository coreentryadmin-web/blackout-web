import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("ticker route wraps JSON with roundFloats at the boundary (matches list route)", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(
    src,
    /return NextResponse\.json\(roundFloats\(\{ snapshot, symbol \}\)/,
    "per-ticker dark-pool must round member-visible floats like /api/market/dark-pool"
  );
});
