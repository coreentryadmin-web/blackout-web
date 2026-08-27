/**
 * Regression guard for the 2026-08-27 fix: `handleZoomReset` (the ⟲ button in VectorZoomControls)
 * used to call `displayBarsFromMinute(minuteBarsRef.current, timeframeRef.current)` with no
 * cursor-time argument at all — unlike `applyFrame`'s own call to the same helper, which always
 * passes the replay cursor's timeline time as the third argument. `minuteBarsRef` keeps accumulating
 * live bars even while a member is scrubbed into replay (the whole reason `applyFrame` slices it),
 * so hitting reset mid-scrub re-centered the viewport on a bar count that includes bars AFTER the
 * replay cursor — corrupting the frame the member was looking at. VectorToolbar has no replay guard
 * on the zoom-reset button either (unlike VectorIntradayZoomControls' preset selector, which IS
 * disabled via `disabled={replayMode}`), so the button stays clickable throughout a replay session.
 *
 * Does not render VectorChart (no local test harness, per VectorChart-footer-labels.test.ts's
 * precedent); asserts on the source so a future edit near this handler can't silently reintroduce
 * the missing cursor-time argument.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("guard: handleZoomReset scopes displayBarsFromMinute to the replay cursor", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");
  const handler = src.match(
    /const handleZoomReset = useCallback\(\(\) => \{[\s\S]*?\}, \[syncCandleViewportFromRange\]\);/
  );
  assert.ok(handler, "expected handleZoomReset to exist");
  assert.match(
    handler![0],
    /replayModeRef\.current \? \(timelineRef\.current\[cursorIndexRef\.current\] \?\? undefined\) : undefined/,
    "must compute a cursor-time value gated on replayModeRef, mirroring applyFrame's own cursor-scoping"
  );
  assert.match(
    handler![0],
    /displayBarsFromMinute\(minuteBarsRef\.current, timeframeRef\.current, cursorTime\)/,
    "must pass the computed cursorTime as displayBarsFromMinute's third argument"
  );
});
