import test from "node:test";
import assert from "node:assert/strict";
import { WallRailPrimitive } from "./vector-wall-rail-primitive";
import type { WallRailData } from "./vector-wall-rail-primitive";
import type { StrikeTrail } from "./vector-wall-history";
import type { VectorWallEvent } from "./vector-wall-events";

/**
 * Regression: event glyphs (birth/death/handover/flip ticks, the "Events" toggle) must be placed
 * WITHIN their containing candle, the same way bead buckets already are — not dropped whenever
 * their bucket time doesn't land exactly on a bar timestamp.
 *
 * THE BUG THIS EXISTS FOR. `vector-bead-x-projection.ts`'s own docblock documents the defect this
 * repeats: `ts.timeToCoordinate(t)` only resolves a pixel when `t` is literally one of the
 * series' own bar times. The rail records a bead/event every ~5s while a candle can span minutes,
 * so the overwhelming majority of bucket times are NOT bar times, and a bare `timeToCoordinate`
 * call returns null for them — which the caller then reads as "off-screen" and silently drops.
 * `#2328` fixed exactly this for the BEAD path (`addTrail`'s `x`, now routed through
 * `projectBucketX`), but the EVENT-GLYPH path a few hundred lines below it (added earlier, in
 * `#2241`, and never revisited when `#2328` landed) still calls `ts.timeToCoordinate(g.time)`
 * directly. Every glyph whose `g.time` isn't an exact bar time — i.e. nearly every birth/death/
 * handover/wall-shift glyph a real session produces, since `composeWallEventGlyphs` stamps them
 * at the SAME sub-bar recorder-bucket granularity as bead points — is silently dropped, so the
 * member-facing "Events" toggle renders almost nothing at any candle interval coarser than the
 * recorder's own bucket cadence (effectively every production timeframe).
 *
 * `WallRailPrimitive` is a plain class with no DOM dependency beyond optional `window` checks that
 * degrade gracefully under Node, so `project()` can be driven directly with minimal chart/series
 * stubs (same pattern as the sibling king-emph-first-sight test in this file).
 */

/** Mimics the REAL chart contract: `timeToCoordinate` resolves a pixel ONLY for an exact bar
 *  timestamp, null otherwise — never a smooth function of arbitrary numeric input. A looser mock
 *  (e.g. `t => t - origin` for any `t`) would make this bug invisible. */
function makeChart(barSpacing: number, barTimes: readonly number[]) {
  const indexByTime = new Map(barTimes.map((t, i) => [t, i]));
  return {
    timeScale() {
      return {
        options() {
          return { barSpacing };
        },
        timeToCoordinate(t: unknown) {
          if (typeof t !== "number") return null;
          const idx = indexByTime.get(t);
          return idx == null ? null : idx * barSpacing;
        },
      };
    },
  } as unknown as Parameters<WallRailPrimitive["attached"]>[0]["chart"];
}

function makeSeries(priceMap: Map<number, number>) {
  return {
    priceToCoordinate(strike: number) {
      return priceMap.has(strike) ? priceMap.get(strike)! : null;
    },
  } as unknown as Parameters<WallRailPrimitive["attached"]>[0]["series"];
}

function soleStrikeTrail(strike: number, points: Array<{ time: number; pct: number }>): StrikeTrail {
  return {
    strike,
    points,
    bornAt: points[0]!.time,
    lastSeen: points[points.length - 1]!.time,
    active: true,
  };
}

test("WallRailPrimitive.project(): an event glyph at a sub-bar bucket time is placed WITHIN its candle, not dropped", () => {
  const prim = new WallRailPrimitive();
  const barTimes = [1000, 1180]; // a 180s (3m) bar grid
  const barSpacing = 18;
  prim.attached({
    chart: makeChart(barSpacing, barTimes),
    series: makeSeries(new Map([[100, 50]])),
    requestUpdate: () => {},
  } as Parameters<WallRailPrimitive["attached"]>[0]);

  // The trail's own points sit exactly on bar times so bead placement (already fixed) is not
  // what's under test — only the glyph's placement is.
  const callTrail = soleStrikeTrail(100, [
    { time: 1000, pct: 5 },
    { time: 1180, pct: 10 },
  ]);

  // A real wall-shift/birth/handover glyph timestamped at a 5s-cadence bucket 90s into the first
  // 180s bar — never exactly a bar time, which is the normal case, not an edge case.
  const event: VectorWallEvent = {
    time: 1090,
    lens: "gex",
    kind: "call_wall_new",
    message: "Call wall forming at 100",
    severity: "info",
    strike: 100,
    side: "call",
  };

  const data: WallRailData = {
    callTrails: [callTrail],
    putTrails: [],
    maxPct: 10,
    callMaxPct: 10,
    putMaxPct: 0,
    callColor: "#ffd60a",
    putColor: "#d97bff",
    showEventGlyphs: true,
    eventLens: "gex",
    wallEvents: [event],
    barTimes,
    intervalSec: 180,
  };

  prim.setData(data, true);
  const projected = prim.project();
  assert.ok(projected, "project() must return a projection for valid, visible data");

  assert.equal(
    projected!.glyphs.length,
    1,
    "the sub-bar event glyph must be projected within its candle, not silently dropped because " +
      "its bucket time isn't an exact bar timestamp"
  );
  const glyph = projected!.glyphs[0]!;
  // Interpolated: 90s into a 180s bar spanning px [0, 18] -> halfway, px 9.
  assert.equal(glyph.x, 9, "glyph x must be interpolated within the bar, matching the bead path");
  assert.equal(glyph.y, 50);
});
