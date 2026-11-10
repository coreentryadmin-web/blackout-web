import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "data-integrity-checks.ts"), "utf8");

test("data-integrity-checks resolves GEX via retry + heatmap fallback", () => {
  assert.match(src, /resolveGexPositioningForIntegrity/);
  assert.match(src, /gexPositioningFromHeatmap/);
  assert.match(src, /fetchGexHeatmap/);
  assert.match(src, /GEX_INTEGRITY_RETRY_MS/);
});
