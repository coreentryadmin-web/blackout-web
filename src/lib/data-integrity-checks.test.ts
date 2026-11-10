import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "data-integrity-checks.ts"),
  "utf8"
);

test("data-integrity C6 skips GEX cold assertions when Polygon circuit is open", () => {
  assert.match(src, /import \{ isPolygonCircuitOpen \} from "@\/lib\/providers\/polygon-rate-limiter"/);
  const c6 = src.match(/\/\/ C6[\s\S]*?return \{ marketOpen: true/)?.[0] ?? "";
  assert.match(c6, /isPolygonCircuitOpen\(\)/);
  assert.match(c6, /if \(polygonPaused\) continue/);
});
