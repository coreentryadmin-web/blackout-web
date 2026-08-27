/**
 * Regression guard for the 2026-08-27 fix: the crosshair-move handler's `interactionHot` branch
 * (the ~600ms gesture-cooldown window after a wheel-zoom/drag-pan) used to fall back to the LIVE
 * wall/flip refs instead of the point-in-time `wallsAtCrosshairTime`/`flipAtCrosshairTime` lookup
 * — not just during Replay, but any time the member hovers an OLDER bar mid-session too, since
 * those lookup functions answer "what were the walls/flip AT the hovered time," not "what are
 * they right now." Substituting live data there silently mislabeled a historical hover with
 * today's/right-now's levels for the gesture-cooldown window. The sibling `gexCell` and
 * wall-event-tooltip computations in the same handler already suppress (render nothing) during
 * `interactionHot` instead of substituting wrong data; this fix brings walls/flip in line with
 * that same "defer heavy work, never serve wrong data" pattern.
 *
 * Does not render VectorChart (it's a 4900+ line canvas-heavy component with no local test
 * harness, per VectorChart-footer-labels.test.ts's precedent); asserts on the source so a future
 * edit near this handler can't silently reintroduce the live-data substitution.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("guard: crosshair walls/flip suppress (not substitute live data) during an active gesture", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");

  const wallsBlock = src.match(/const walls = interactionHot\s*\?[\s\S]{0,200}?wallsAtCrosshairTime\(/);
  assert.ok(wallsBlock, "expected the walls ternary to exist");
  assert.match(wallsBlock![0], /const walls = interactionHot\s*\?\s*null\s*:/, "walls must be null during interactionHot, not a live-ref fallback");
  assert.doesNotMatch(wallsBlock![0], /wallsForActiveLens/, "must not substitute the live wallsForActiveLens during a gesture");

  const flipBlock = src.match(/flip: interactionHot\s*\?[\s\S]{0,200}?flipAtCrosshairTime\(/);
  assert.ok(flipBlock, "expected the flip ternary to exist");
  assert.match(flipBlock![0], /flip: interactionHot\s*\?\s*null\s*:/, "flip must be null during interactionHot, not a live-ref fallback");
  assert.doesNotMatch(flipBlock![0], /flipForActiveLens/, "must not substitute the live flipForActiveLens during a gesture");
});
