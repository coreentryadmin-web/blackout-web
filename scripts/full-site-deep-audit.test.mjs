import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("heatmap wall oracle side-constrains by spot (matches heatmap-verifier #2503)", () => {
  const src = readFileSync(join(process.cwd(), "scripts/full-site-deep-audit.mjs"), "utf8");
  assert.match(src, /function deriveWalls\(st, spot\)/);
  assert.match(src, /strike > spot/);
  assert.match(src, /strike < spot/);
  assert.match(src, /deriveWalls\(block\.strike_totals, hm\.spot\)/);
});
