/**
 * Regression guard for the 2026-08-27 fix: the repaint-on-node-density-change effect used to call
 * refreshOverlays with the LIVE liveGexWalls()/liveGammaFlip() getters unconditionally — no replay
 * check at all, unlike every sibling repaint-on-selection-change effect in this file (e.g. the
 * indicator-toggle effect, which conditionally calls applyFrame during replay instead of
 * refreshTrails). Flipping the Nodes density select during replay snapped the gamma-flip line and
 * the axis auto-widening to TODAY's live flip/walls, even though every other overlay stayed
 * frozen at the replay cursor.
 *
 * Does not render VectorChart (no local test harness, per VectorChart-footer-labels.test.ts's
 * precedent); asserts on the source so a future edit near this effect can't silently reintroduce
 * the unconditional live-data call.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("guard: the node-density repaint effect uses applyFrame (not live getters) during replay", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");
  const effect = src.match(
    /useEffect\(\(\) => \{[\s\S]*?refreshOverlays\([\s\S]*?\}, \[nodeDensity, refreshTrails, refreshOverlays, liveGexWalls, liveGammaFlip\]\);/
  );
  assert.ok(effect, "expected the node-density repaint effect to exist");
  assert.match(effect![0], /if \(replayModeRef\.current\) \{/, "must branch on replay state");
  assert.match(effect![0], /applyFrameRef\.current\?\.\(/, "must repaint via applyFrame during replay");
});
