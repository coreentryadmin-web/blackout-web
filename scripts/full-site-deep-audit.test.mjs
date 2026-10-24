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

test("full-site-deep-audit PREMIUM-CAP check uses the real $35/share cap, not a stale $20", () => {
  const constantsSrc = readFileSync(
    join(here, "..", "src", "features", "nighthawk", "lib", "constants.ts"),
    "utf8"
  );
  const match = constantsSrc.match(/export const MAX_OPTION_PREMIUM_PER_SHARE = (\d+);/);
  assert.ok(match, "MAX_OPTION_PREMIUM_PER_SHARE not found in nighthawk constants.ts");
  const realCap = Number(match[1]);

  assert.match(src, /NIGHTHAWK_PREMIUM_CAP_PER_SHARE\s*=\s*(\d+)/);
  const auditCap = Number(src.match(/NIGHTHAWK_PREMIUM_CAP_PER_SHARE\s*=\s*(\d+)/)[1]);
  assert.equal(auditCap, realCap, "audit's premium cap has drifted from the real product constant");

  // Guards against reintroducing a second, hardcoded cap literal in the PREMIUM-CAP check itself.
  assert.equal(/ep > 20\)/.test(src), false);
});
