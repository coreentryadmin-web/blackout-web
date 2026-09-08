/**
 * Regression guard for a future-timestamp freshness bug in `MeridianFreshness` (2026-09-03). The
 * "updated Ns ago" indicator computed `ageMs = Math.max(0, now - t)` — a future `asOf` (clock
 * skew, or a bad upstream timestamp) clamped to exactly 0, reading as "updated 0s ago", the
 * freshest possible label, which is backwards for data whose real age cannot be verified.
 *
 * Fix: `stale` is now derived from the RAW (unclamped) age, and a future `asOf` more than
 * FUTURE_ASOF_TOLERANCE_MS (5s — ordinary clock skew) ahead of now also flips it stale; only the
 * displayed label still clamps to 0 for legibility. Does not render the component (no market data
 * in this test); asserts on the source so this guard cannot be silently dropped.
 * Run: `npx tsx --test src/features/meridian/components/meridian-viz-freshness.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/meridian/components/meridian-viz.tsx"), "utf8");

test("MeridianFreshness: stale is derived from the raw (unclamped) age, not the clamped display age", () => {
  const start = src.indexOf("export function MeridianFreshness(");
  assert.ok(start > 0, "MeridianFreshness exists");
  const body = src.slice(start, start + 1200);
  assert.match(
    body,
    /const rawAgeMs = now - t;/,
    "must compute the raw signed age before any clamping"
  );
  assert.match(
    body,
    /rawAgeMs > staleAfterMs \|\| rawAgeMs < -FUTURE_ASOF_TOLERANCE_MS/,
    "a future-dated asOf must also flip stale=true, not read as freshest-possible via the Math.max(0,...) clamp"
  );
  assert.match(
    body,
    /const ageMs = Math\.max\(0, rawAgeMs\);/,
    "the DISPLAYED age label may still clamp to 0 for legibility — only the stale flag must see the raw value"
  );
});
