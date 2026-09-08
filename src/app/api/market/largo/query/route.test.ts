import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("roundFloats at the API boundary (Largo query)", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /NextResponse\.json\(roundFloats\(result\)/);
});
