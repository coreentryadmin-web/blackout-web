/**
 * Regression guard for a future-timestamp freshness bug in `MatrixFreshness` (2026-09-03). The
 * "as of HH:MM:SS ET" indicator computed `stale` as `Date.now() - t > MATRIX_STALE_MS`. A server
 * `asof` in the future (clock skew, or a bad upstream timestamp) produced a negative subtraction,
 * which trivially failed `> MATRIX_STALE_MS` and rendered the fresh/green state for a sample whose
 * real age cannot be verified.
 *
 * Fix: an `asof` more than FUTURE_ASOF_TOLERANCE_MS (5s — ordinary clock skew) ahead of now is now
 * also treated as stale, not fresh. Does not render the component (no market data in this test);
 * asserts on the source so this guard cannot be silently dropped.
 * Run: `npx tsx --test src/features/thermal/components/GexHeatmap-matrix-freshness.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/thermal/components/GexHeatmap.tsx"), "utf8");

test("GexHeatmap: FUTURE_ASOF_TOLERANCE_MS is defined near MatrixFreshness", () => {
  assert.match(src, /const FUTURE_ASOF_TOLERANCE_MS = 5_000;/);
});

test("MatrixFreshness: stale is true for a future asof beyond tolerance, not just an old one", () => {
  const start = src.indexOf("function MatrixFreshness(");
  assert.ok(start > 0, "MatrixFreshness exists");
  const end = src.indexOf("\n}", start);
  const body = src.slice(start, end);
  assert.match(
    body,
    /ageMs > MATRIX_STALE_MS \|\| ageMs < -FUTURE_ASOF_TOLERANCE_MS/,
    "a future-dated asof must also flip stale=true, not read as freshest-possible"
  );
});
