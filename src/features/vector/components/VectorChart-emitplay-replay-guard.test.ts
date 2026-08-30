/**
 * Regression guard for the 2026-08-27 fix: unlike every sibling emit function in this file
 * (refreshTrails's own internal guard, the lens-change effect, the SSE-tick handler — all gated
 * on replayModeRef/inReplay), `emitPlay` had no replay check at all. It's called on a live poll
 * cadence (fetchMaxPain/fetchExpectedMove, ~15-30s) that stays armed during replay, so the
 * Suggested Play card kept silently re-rendering a plan built from TODAY's live spot/walls/flip
 * while every other overlay (candles, beads) stayed frozen at the replay cursor — with no STALE
 * badge, since the live SSE feed itself was fresh.
 *
 * Does not render VectorChart (it's a 4900+ line canvas-heavy component with no local test
 * harness, per VectorChart-footer-labels.test.ts's precedent); asserts on the source so a future
 * edit near this function can't silently reintroduce the leak.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("guard: emitPlay must not run during replay", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");
  const fn = src.match(/const emitPlay = useCallback\(\(\) => \{[\s\S]*?\}, \[ticker,/);
  assert.ok(fn, "expected the emitPlay function to exist");
  assert.match(fn![0], /if \(replayModeRef\.current\) return;/, "emitPlay must early-return during replay");
});
