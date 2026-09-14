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
  // BUG FIX (2026-09-14): raw `data.updatedAt` was itself a misleading freshness signal (bumped
  // by a single-ticker append that refreshes just one row — see vector-age-format.ts's own
  // comment). Freshness now comes from `effectiveUniverseAsOf(data)`, the median row `asOf` —
  // updated this assertion to match while preserving the original intent.
  const src = readFileSync(join(root, "components/VectorTickerComparisonStrip.tsx"), "utf8");
  assert.match(src, /\berror\b.*=\s*useVectorUniverseSnapshot\(\)|useVectorUniverseSnapshot\(\).*\berror\b/s, "must destructure error from the snapshot hook");
  assert.match(src, /effectiveUniverseAsOf\(data\)/, "must derive freshness via effectiveUniverseAsOf(data), not raw data.updatedAt");
  assert.match(src, /formatVectorAge\(/, "must format the age using the shared age formatter");
  assert.match(src, /isVectorUniverseSnapshotStale\(/, "must use the shared staleness helper (future-at guard)");
  assert.match(src, /is-stale/, "must render a distinct visual state once the snapshot is old");
});
