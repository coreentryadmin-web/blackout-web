/**
 * Regression guard for a future-timestamp freshness-badge bug (2026-09-03). The tape's LIVE/STALE
 * badge derived `dataAgeMs` as a raw `Date.now() - newestAt` subtraction. A print with a future
 * `alerted_at` (UW clock skew or a bad upstream stamp) produced a NEGATIVE age, which trivially
 * failed `dataAgeMs > 5min` and painted the badge green LIVE even if the real tape was dead — the
 * exact "stale tape reads green LIVE" failure the surrounding comment explicitly warns against.
 *
 * Fix: `newestAt` now excludes any candidate print whose `signalWindowAgeMs` comes back null (more
 * than FUTURE_PRINT_TOLERANCE_MS ahead of now) — the same future-timestamp guard the split/velocity
 * signal detectors already apply to this exact field — so a bad print can never become the
 * freshness anchor. Does not render the component (no market data in this test); asserts on the
 * source so this guard cannot be silently dropped from the `newestAt` computation.
 * Run: `npx tsx --test src/features/helix/components/FlowFeed-freshness-badge.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/helix/components/FlowFeed.tsx"), "utf8");

test("FlowFeed: signalWindowAgeMs is imported from the shared detection lib", () => {
  assert.match(
    src,
    /import\s*\{[^}]*signalWindowAgeMs[^}]*\}\s*from\s*"@\/features\/helix\/lib\/helix-signal-detection"/
  );
});

test("FlowFeed: newestAt excludes a future-dated print via signalWindowAgeMs, not a raw max()", () => {
  const start = src.indexOf("const newestAt = useMemo(");
  assert.ok(start > 0, "newestAt computation exists");
  const end = src.indexOf("}, [displayAlerts]);", start);
  const body = src.slice(start, end);
  assert.match(
    body,
    /signalWindowAgeMs\(ms, nowMs\) == null/,
    "a print whose age cannot be trusted (future-dated beyond tolerance) must be skipped, never treated as newest"
  );
});

test("FlowFeed: dataAgeMs clamps negative ages to 0 (defense-in-depth after newestAt filter)", () => {
  assert.match(src, /Math\.max\(0,\s*Date\.now\(\)\s*-\s*newestAt\)/);
});
