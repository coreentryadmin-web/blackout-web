/**
 * Regression guard for the 2026-08-27 fix: the SSE tick handler's `onSpotChange?.(curSpot)`
 * callback was left unconditional while the sibling `gexHeatmapPrimitiveRef.current?.setSpot()`
 * call three lines later was correctly gated behind `!inReplay` (added in the prior replay-freeze
 * fix, PR #2957). `onSpotChange` carries the identical live-tick spot for the identical purpose —
 * it is threaded through VectorPageShell into `setLiveSpot`, which VectorOdteMatrixRail then
 * treats as its PRIMARY spot source (`liveSpot ?? data?.spot ?? initialSpot`), driving the
 * highlighted spot row, King-strike, and call/put-wall flags. Left ungated, the 0DTE matrix rail
 * kept tracking the LIVE market price during replay while the chart itself (candles, the heatmap
 * marker) correctly froze at the scrubbed cursor — the rail visibly disagreed with the chart it
 * sits next to.
 *
 * Does not render VectorChart (it's a 4900+ line canvas-heavy component with no local test
 * harness, per VectorChart-footer-labels.test.ts's precedent); asserts on the source so a future
 * edit near this tick handler can't silently reintroduce the ungated callback.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("guard: onSpotChange must not fire during replay — it feeds the 0DTE matrix rail's live spot", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");
  const tickBlock = src.match(/spotRef\.current = curSpot;[\s\S]{0,1200}?gexHeatmapPrimitiveRef\.current\?\.setSpot\(curSpot\);\s*\}/);
  assert.ok(tickBlock, "expected the SSE tick handler's spot-update block to exist");
  // Both the callback and the heatmap marker must be inside the SAME `if (!inReplay)` gate.
  // NOTE (round 506): the callback itself now reads through `onSpotChangeRef.current` (DISCOVERY
  // round 506's stale-closure fix) rather than the bare `onSpotChange` closure — see
  // VectorChart-onfreshness-onspotchange-ref-mirror.test.ts for that fix's own guard. This
  // assertion is unaffected: it only cares that the call (whichever form it takes) stays inside
  // the same `!inReplay` gate as the heatmap marker.
  assert.match(
    tickBlock![0],
    /if \(!inReplay\) \{[\s\S]*onSpotChangeRef\.current\?\.\(curSpot\);[\s\S]*gexHeatmapPrimitiveRef\.current\?\.setSpot\(curSpot\);[\s\S]*\}/,
    "onSpotChange (via onSpotChangeRef) and the heatmap spot marker must be gated together behind !inReplay"
  );
});
