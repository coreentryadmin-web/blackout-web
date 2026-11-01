/**
 * Regression guard: the fast-move GEX heatmap force-refetch fired from inside `connectLive`'s live
 * SSE tick handler used to have NO staleness check on the DTE horizon, unlike its sibling
 * `fetchGexHeatmap` (the poll-interval version of the exact same
 * `/api/market/vector/gex-heatmap` call a few hundred lines earlier in this file), which checks
 * `dteHorizonRef.current !== dteHorizon` both right after the fetch resolves AND again after the
 * json body is parsed before ever touching `gexHeatmapGridRef`/repainting the primitive.
 *
 * The live-tick duplicate skipped both checks entirely: it fired on `&dte=${dteHorizonRef.current}`
 * but never re-verified that value hadn't changed by the time the response landed. A ticker switch
 * is safe today only because every render site remounts VectorChart via `key={activeTicker}` — but
 * a DTE-horizon switch does NOT remount (same component instance, same shared refs), so an in-flight
 * force-refetch for the OLD horizon could land after the switch and silently overwrite the
 * already-correct grid the horizon-change effect had just fetched, repainting the wrong horizon's
 * walls onto the chart.
 *
 * Does not render VectorChart (no local test harness, per VectorChart-footer-labels.test.ts's
 * precedent); asserts on the source so a future edit near this handler can't silently drop the
 * staleness check again.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("guard: the live-tick GEX heatmap force-refetch re-checks dteHorizonRef before writing/painting", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");
  const block = src.match(
    /if \(move >= VECTOR_GEX_HEATMAP_FAST_MOVE_PCT\) \{[\s\S]*?\.catch\(\(\) => \{\}\);\s*\n\s*\}/
  );
  assert.ok(block, "expected the fast-move force-refetch block to exist");

  // Must capture the horizon at the moment the fetch is fired, not re-read a live ref later.
  assert.match(
    block![0],
    /const horizonAtFetch = dteHorizonRef\.current;/,
    "must snapshot dteHorizonRef.current into a local before firing the fetch"
  );

  // Must re-verify that snapshot BOTH right after the fetch resolves and again after the json
  // body is parsed — mirroring fetchGexHeatmap's own two-check pattern — before ever writing to
  // gexHeatmapGridRef or repainting the primitive.
  const horizonChecks = block![0].match(/dteHorizonRef\.current !== horizonAtFetch/g) ?? [];
  assert.equal(
    horizonChecks.length,
    2,
    "must bail on a stale horizon both before and after parsing the response body"
  );

  // The ref write and the primitive repaint must appear AFTER the second horizon check, not before.
  const secondCheckIdx = block![0].lastIndexOf("dteHorizonRef.current !== horizonAtFetch");
  const gridWriteIdx = block![0].indexOf("gexHeatmapGridRef.current = grid;");
  assert.ok(gridWriteIdx > secondCheckIdx, "gexHeatmapGridRef write must happen after the stale-horizon bail");
});
