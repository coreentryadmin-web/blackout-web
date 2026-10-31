/**
 * Regression guard for an interrupted count-up animation snapping to a value the viewer never
 * actually saw (round 179, 2026-10-31).
 *
 * `MeridianCountUp` interpolates `shown` from an old value to a new one over `durationMs`
 * (~520ms) using a cubic ease-out driven by `requestAnimationFrame`. If `value` changes AGAIN
 * before that animation finishes — plausible any time a metric updates faster than it counts up
 * — the effect re-runs: React calls the in-flight effect's cleanup (which cancels the pending
 * rAF) before starting the new one.
 *
 * That cleanup used `fromRef.current = value`, where `value` is THIS effect's own TARGET — the
 * number the interrupted animation was still mid-flight toward, which the viewer never actually
 * saw rendered (the animation never reached it). The next animation's very first tick runs at
 * `t=0` (`eased=0`), so `setShown(from + (target - from) * 0)` is just `setShown(from)` — the
 * display SNAPS straight to that unseen stale target for one frame before continuing on toward
 * the newest value. On a ring or metric that updates faster than ~520ms, this is a visible
 * flicker/jump to a number the data never actually held at the time it was shown.
 *
 * Fix: track the value actually last RENDERED (`shownRef`, updated in lockstep with every
 * `setShown` call, including mid-flight partial values) and resume an interrupted animation from
 * THAT, never from the effect's own stale target.
 *
 * Does not render the component (no render harness in this repo for hooks/rAF — see
 * VectorScanner.test.ts and this file's own sibling meridian-viz-freshness.test.ts for the same
 * precedent); asserts on the source so this fix cannot be silently reverted.
 * Run: `npx tsx --experimental-test-module-mocks --test src/features/meridian/components/meridian-viz-countup-interrupt.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/meridian/components/meridian-viz.tsx"), "utf8");

function countUpBody(): string {
  const start = src.indexOf("export function MeridianCountUp(");
  assert.ok(start > 0, "MeridianCountUp exists");
  const next = src.indexOf("export function", start + 10);
  assert.ok(next > start, "a following export marks the end of MeridianCountUp");
  return src.slice(start, next);
}

test("MeridianCountUp: a `shown`-mirroring ref exists to capture the last actually-rendered value", () => {
  const body = countUpBody();
  assert.match(
    body,
    /const shownRef = useRef<number \| null>\(value\);/,
    "needs a ref that mirrors `shown` synchronously, so the cleanup below can read the last " +
      "rendered value the instant a new prop arrives, before React commits any render"
  );
  assert.match(
    body,
    /setShown\(next\);\s*\n\s*shownRef\.current = next;/,
    "shownRef must be updated in the SAME tick as every setShown call inside the rAF loop, " +
      "including a mid-flight partial value — not just at the start or end of the animation"
  );
});

test("MeridianCountUp: an interrupted animation resumes from the last RENDERED value, not the stale target", () => {
  const body = countUpBody();
  // The regression: resuming from `value` (this effect's own target) instead of the value that
  // was actually on screen. Must not reappear verbatim in the cleanup.
  assert.doesNotMatch(
    body.slice(body.indexOf("return () => {")),
    /fromRef\.current = value;\s*\n\s*};/,
    "the cleanup must not resume the next animation from `value` (this effect's own stale " +
      "target) — that is exactly the snap-to-unseen-value bug this test guards against"
  );
  assert.match(
    body.slice(body.indexOf("return () => {")),
    /fromRef\.current = shownRef\.current;/,
    "the cleanup must resume the next animation from shownRef.current — the value actually " +
      "last rendered — so an interrupted count-up continues smoothly instead of snapping"
  );
});
