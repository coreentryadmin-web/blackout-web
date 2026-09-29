import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/features/vector");

test("VectorScanner: surfaces the universe snapshot's staleness instead of rendering it silently", () => {
  // Regression guard for the 2026-08-27 fix: VectorUniverseSnapshot.updatedAt was plumbed all the
  // way to the client explicitly "for consumers to age-gate" (server comment, vector-universe.ts)
  // against a 48h Redis TTL, but VectorScanner never read it. If the 5-minute rebuild cron stops
  // firing, the scanner kept showing the last cached scan, unchanged, for up to 48 hours with zero
  // visual difference from a live one. There's no rendering harness in this repo (no
  // renderHook/@testing-library), so this asserts the fix is wired into the source, matching the
  // pattern already used elsewhere in this suite (e.g. VectorContractPicksCard.test.ts).
  //
  // BUG FIX (2026-09-14): raw `data.updatedAt` was itself a misleading freshness signal (bumped by
  // a single-ticker append that refreshes just one row — see vector-age-format.ts's own comment).
  // Freshness now comes from `effectiveUniverseAsOf(data)`, the median row `asOf` — updated this
  // assertion to match while preserving the original intent (the staleness disclosure must still
  // exist and be wired to the formatter/staleness helper).
  const src = readFileSync(join(root, "components/VectorScanner.tsx"), "utf8");
  assert.match(src, /effectiveUniverseAsOf\(data\)/, "must derive freshness via effectiveUniverseAsOf(data), not raw data.updatedAt");
  assert.match(src, /formatVectorAge\(/, "must format the age using the shared age formatter");
  assert.match(src, /is-stale/, "must render a distinct visual state once the snapshot is old");
});
