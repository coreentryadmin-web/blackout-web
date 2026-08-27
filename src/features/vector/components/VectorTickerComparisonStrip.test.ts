import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/features/vector");

test("VectorTickerComparisonStrip: surfaces the shared universe snapshot's staleness/error instead of rendering it silently", () => {
  // Regression guard for the 2026-08-27 fix: this component reads the SAME shared universe
  // snapshot VectorScanner does (useVectorUniverseSnapshot), and VectorScanner was just given a
  // staleness disclosure for exactly that data. This component reused the fetch but not the
  // disclosure -- fixed here so the gap can't ship the moment this (currently unmounted)
  // component gets wired into a page. There's no rendering harness in this repo, so this asserts
  // the fix is wired into the source, matching the pattern used elsewhere in this suite.
  const src = readFileSync(join(root, "components/VectorTickerComparisonStrip.tsx"), "utf8");
  assert.match(src, /\berror\b.*=\s*useVectorUniverseSnapshot\(\)|useVectorUniverseSnapshot\(\).*\berror\b/s, "must destructure error from the snapshot hook");
  assert.match(src, /data\.updatedAt/, "must read the snapshot's updatedAt field");
  assert.match(src, /formatVectorAge\(/, "must format the age using the shared age formatter");
  assert.match(src, /VECTOR_UNIVERSE_STALE_MS/, "must use the shared staleness threshold");
  assert.match(src, /is-stale/, "must render a distinct visual state once the snapshot is old");
});
