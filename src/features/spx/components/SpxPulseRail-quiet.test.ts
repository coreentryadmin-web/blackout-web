import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/components/SpxPulseRail.tsx", "utf8");

test("SpxPulseRail quiet footer clamps Tier-1 event age for clock skew", () => {
  assert.match(src, /const tier1AgeMs = lastTier1 \? Math\.max\(0, Date\.now\(\) - lastTier1\.at\)/);
  assert.match(src, /tier1AgeMs > QUIET_AFTER_MS/);
  assert.doesNotMatch(
    src,
    /return !lastTier1 \|\| Date\.now\(\) - lastTier1\.at > QUIET_AFTER_MS/
  );
});
