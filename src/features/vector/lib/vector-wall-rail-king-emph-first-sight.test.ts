import test from "node:test";
import assert from "node:assert/strict";
import { WallRailPrimitive } from "./vector-wall-rail-primitive";
import type { WallRailData } from "./vector-wall-rail-primitive";
import type { StrikeTrail } from "./vector-wall-history";

/**
 * Regression: the live king's crown emphasis must SNAP on first sight, not ease up from 0.
 *
 * `WallRailPrimitive.project()` eases the king-emphasis channel toward its target via a per-frame
 * lerp (`EASE_K`) driven by the private `_tick()` rAF loop. The bead HALF-HEIGHT channel already
 * guards against the obvious trap this produces — a brand-new key defaulting to 0 and climbing —
 * by seeding `_easedHalf` with the target on first sight (`cur == null -> half = target`). The
 * king-emphasis channel had no equivalent guard: it read `this._kingEmph.get(kKey) ?? 0`, so on
 * the FIRST EVER `project()` call for a strike (fresh mount, ticker switch, or any wall newly
 * entering the rendered set) the live king's emphasis rendered as 0 — i.e. the king painted
 * un-emphasized — until the rAF loop had run at least once to ease it up. `project()` runs
 * synchronously off `requestUpdate()` inside `setData()`, strictly before any queued
 * `requestAnimationFrame` callback can fire, so this is not a one-frame rounding error: every
 * ticker switch and every fresh load painted the live king with no crown at all on its very first
 * (and, during a fast zoom/pan burst before the first tick lands, possibly several) repaints.
 *
 * `WallRailPrimitive` is a plain class with no DOM dependency beyond optional `window` checks that
 * degrade gracefully under Node, so `project()` can be driven directly with minimal chart/series
 * stubs — unlike the canvas-only paint path covered by source-scan tests elsewhere in this file.
 */

function makeChart(barSpacing: number) {
  return {
    timeScale() {
      return {
        options() {
          return { barSpacing };
        },
        timeToCoordinate(t: unknown) {
          return typeof t === "number" ? t - 1000 : null;
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

test("WallRailPrimitive.project(): live king renders full emphasis on the very first project() call", () => {
  const prim = new WallRailPrimitive();
  prim.attached({
    chart: makeChart(10),
    series: makeSeries(new Map([[100, 200], [110, 150]])),
    requestUpdate: () => {},
  } as Parameters<WallRailPrimitive["attached"]>[0]);

  // Each side carries exactly ONE trail, so that trail is trivially its own side's king at the
  // live bucket (kingStrikeByTime has nothing else to compare it against) — isolating the bug to
  // the emphasis-easing seed rather than any kingship-selection logic.
  const callTrail = soleStrikeTrail(100, [
    { time: 1000, pct: 1 },
    { time: 1010, pct: 10 },
  ]);
  const putTrail = soleStrikeTrail(110, [
    { time: 1000, pct: 3 },
    { time: 1010, pct: 20 },
  ]);

  const data: WallRailData = {
    callTrails: [callTrail],
    putTrails: [putTrail],
    maxPct: 20,
    callMaxPct: 10,
    putMaxPct: 20,
    callColor: "#ffd60a",
    putColor: "#d97bff",
  };

  // setData() is the real entry point — it is what calls requestUpdate() (and, in a browser,
  // schedules the rAF loop) before anything has ever ticked, which is exactly the window this
  // test exercises. project() is then called the same way the chart's own pane-view renderer()
  // would call it on the resulting (first, pre-tick) repaint.
  prim.setData(data, true);
  const projected = prim.project();
  assert.ok(projected, "project() must return bands for valid, visible data");

  for (const band of projected!.bands) {
    const live = band.pts[band.pts.length - 1]!;
    assert.equal(
      live.emph,
      1,
      `the live bucket's sole strike on this side is unambiguously its own king and must render ` +
        `full emphasis (1) on first sight, not an eased-from-zero value (got ${live.emph})`
    );
  }
});
