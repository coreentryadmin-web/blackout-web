import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("heatmap wall audit uses side-constrained wallsFromStrikeTotals with spot", () => {
  const src = readFileSync(join(process.cwd(), "scripts/full-site-deep-audit.mjs"), "utf8");
  assert.match(src, /from "\.\/audit\/lib\/gex-wall-invariants\.mjs"/);
  assert.match(
    src,
    /wallsFromStrikeTotals\(\s*block\.strike_totals,\s*hm\.spot\s*\)/
  );
  assert.doesNotMatch(src, /function deriveWalls\(/);
});
