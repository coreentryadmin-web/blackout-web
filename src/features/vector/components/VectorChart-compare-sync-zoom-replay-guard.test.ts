/**
 * Regression guard for the 2026-08-27 fix: the `compareSync?.zoomPreset` effect called
 * `handleIntradayZoomRef.current(payload.preset)` with NO check on `replayModeRef.current` — unlike
 * the per-pane toolbar zoom-preset selector (`VectorIntradayZoomControls`, already
 * `disabled={replayMode}`-gated) and the keyboard shortcut for the same operation (already
 * `if (replayMode) return;`).
 *
 * This IS reachable in production: when Compare panes are unlinked, a member can manually enter
 * replay on one pane (its toolbar replay control is only hidden while linked — see
 * `hideReplayControls={linked}`), then re-link. The relink path only exits replay for panes it put
 * into replay itself (`linkedReplayControlledRef`), so a manually-replaying pane stays in replay
 * while linked. The shared "Sync zoom" command-bar control is gated only on `linked`, not on any
 * pane's replay state, so it can broadcast a zoom preset into the still-replaying pane, which then
 * recomputes its viewport from the full LIVE minute-bar buffer instead of the replay-cursor-sliced
 * one — the same corruption bug just fixed in `handleZoomReset` (#2969), reachable here via the
 * cross-pane broadcast instead of a direct click.
 *
 * Does not render VectorChart (no local test harness, per VectorChart-footer-labels.test.ts's
 * precedent); asserts on the source so a future edit near this effect can't silently reintroduce
 * the missing replay guard.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("guard: the compareSync zoomPreset effect is gated on replayModeRef", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");
  const effect = src.match(
    /useEffect\(\(\) => \{\s*const payload = compareSync\?\.zoomPreset;[\s\S]*?\}, \[chartReady, compareSync\?\.zoomPreset\?\.tick\]\);/
  );
  assert.ok(effect, "expected the compareSync zoomPreset effect to exist");
  assert.match(
    effect![0],
    /if \(replayModeRef\.current\) return;/,
    "must bail out during replay before broadcasting a zoom preset into a replaying pane"
  );
});
