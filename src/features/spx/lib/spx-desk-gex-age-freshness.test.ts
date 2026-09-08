// Regression: Math.max(0, now - asof) before gexStaleFromAge converted clock-skewed future
// pos.asof into gex_age_ms=0 → gex_stale:false (false fresh). gexStaleFromAge already
// fail-closes on negative age beyond WS_TIMESTAMP_FUTURE_TOLERANCE_MS — the clamp hid it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const deskSrc = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");

test("gexDataAgeMs does not clamp negative age with Math.max(0, …)", () => {
  const fnStart = deskSrc.indexOf("function gexDataAgeMs");
  assert.ok(fnStart >= 0);
  const fnBody = deskSrc.slice(fnStart, fnStart + 400);
  assert.doesNotMatch(fnBody, /Math\.max\(0,\s*now - lastGoodGexComputedAt\)/);
  assert.match(fnBody, /return lastGoodGexComputedAt > 0 \? now - lastGoodGexComputedAt/);
});

test("canonical desk GEX path passes raw pos.asof age to gexStaleFromAge", () => {
  const anchor = deskSrc.indexOf("fresh_this_cycle: levels.length > 0");
  assert.ok(anchor >= 0, "canonical GEX return block must exist");
  const block = deskSrc.slice(anchor - 700, anchor + 20);
  assert.doesNotMatch(block, /Math\.max\(0,\s*Date\.now\(\) - asofMs\)/);
  assert.match(block, /const gexAgeMs = Number\.isFinite\(asofMs\) \? Date\.now\(\) - asofMs/);
  assert.match(block, /gex_stale: gexStaleFromAge\(gexAgeMs\)/);
});
