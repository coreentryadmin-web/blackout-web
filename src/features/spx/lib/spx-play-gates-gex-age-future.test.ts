// Regression: future-skewed gex_age_ms must fail-closed in evaluatePlayGates (same guard as
// gexStaleFromAge). Structural test — avoids mock.module (Node 22 incompatible).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const gatesSrc = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-play-gates.ts"), "utf8");

test("spx-play-gates: gex_age_ms future skew uses WS_TIMESTAMP_FUTURE_TOLERANCE_MS fail-closed guard", () => {
  assert.match(
    gatesSrc,
    /import\s*\{\s*WS_TIMESTAMP_FUTURE_TOLERANCE_MS\s*\}\s*from\s*"@\/lib\/ws\/timestamp-freshness"/
  );
  const anchor = gatesSrc.indexOf("if (desk.gex_age_ms != null)");
  assert.ok(anchor >= 0, "gex_age_ms block must exist");
  const block = gatesSrc.slice(anchor, anchor + 500);
  assert.match(block, /desk\.gex_age_ms < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS/);
  assert.match(block, /playGexStaleMaxSec\(\) \+ 1/);
  assert.doesNotMatch(block, /const gexSec = desk\.gex_age_ms \/ 1000;/);
});
