import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "full-site-deep-audit.mjs"), "utf8");

test("full-site-deep-audit uses side-constrained wallsFromStrikeTotals, not unconstrained deriveWalls", () => {
  assert.match(src, /wallsFromStrikeTotals/);
  assert.match(src, /gex-wall-invariants\.mjs/);
  assert.equal(src.includes("function deriveWalls"), false);
});
