/**
 * Regression guard for a future-timestamp bug in resolveZeroDteFreshness (2026-09-03). It computed
 * `nowMs - asOfMs > staleAfterMs` with no guard against asOfMs being in the future (client/server
 * clock skew) — a future asOfMs always read "live", never "stale". The sibling isZeroDteMarkStale
 * (marks-math.ts) already guards against exactly this; this function was missed when that guard
 * was added elsewhere.
 *
 * Does not render the component (no market data in this test); asserts on the source so this
 * guard cannot be silently dropped, matching this repo's established convention for a React
 * component's pure helper function.
 * Run: `npx tsx --test src/features/nighthawk/components/ZeroDteBoard-freshness.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/nighthawk/components/ZeroDteBoard.tsx"), "utf8");

test("ZeroDteBoard: ZERODTE_MARK_FUTURE_TOLERANCE_MS is imported from marks-math", () => {
  assert.match(
    src,
    /import\s*\{\s*ZERODTE_MARK_FUTURE_TOLERANCE_MS\s*\}\s*from\s*"@\/lib\/zerodte\/marks-math"/
  );
});

test("resolveZeroDteFreshness: a future-dated asOfMs reads stale, not live", () => {
  const start = src.indexOf("export function resolveZeroDteFreshness(");
  assert.ok(start > 0, "resolveZeroDteFreshness exists");
  const end = src.indexOf("\n}", start + 400);
  const body = src.slice(start, end);
  assert.match(
    body,
    /if \(ageMs < -ZERODTE_MARK_FUTURE_TOLERANCE_MS\) return "stale";/,
    "a future-dated asOfMs must read stale, not the freshest-possible live status"
  );
});
