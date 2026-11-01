import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHART_GLYPH_EVENT_KINDS,
  composeWallEventGlyphs,
  hitTestProjectedWallEventGlyph,
  trailDerivedGlyphs,
  wallEventToGlyph,
} from "./vector-wall-event-glyphs";
import type { StrikeTrail } from "./vector-wall-history";
import type { VectorWallEvent } from "./vector-wall-events";

function trail(strike: number, times: number[], active = true): StrikeTrail {
  return {
    strike,
    active,
    points: times.map((time, i) => ({
      time,
      pct: 10 + i,
      glow: 1,
      modeled: false,
    })),
  };
}

/** Same as `trail()` but marks the point at `modeledIndex` as reconstructed (not observed). */
function trailWithModeledPoint(
  strike: number,
  times: number[],
  modeledIndex: number,
  active = true
): StrikeTrail {
  const t = trail(strike, times, active);
  t.points[modeledIndex] = { ...t.points[modeledIndex]!, modeled: true };
  return t;
}

test("CHART_GLYPH_EVENT_KINDS excludes building/fading (too dense for rail)", () => {
  assert.equal(CHART_GLYPH_EVENT_KINDS.has("call_wall_building"), false);
  assert.equal(CHART_GLYPH_EVENT_KINDS.has("call_wall_shift"), true);
});

test("wallEventToGlyph: shift maps to handover diamond at new strike", () => {
  const ev: VectorWallEvent = {
    time: 200,
    lens: "gex",
    kind: "call_wall_shift",
    message: "shift",
    severity: "info",
    strike: 6810,
    side: "call",
  };
  const g = wallEventToGlyph(ev);
  assert.ok(g);
  assert.equal(g!.shape, "handover_diamond");
  assert.equal(g!.strike, 6810);
  assert.equal(g!.label, "shift");
});

test("wallEventToGlyph: flip cross uses flip anchor", () => {
  const ev: VectorWallEvent = {
    time: 300,
    lens: "gex",
    kind: "spot_crossed_flip",
    message: "cross",
    severity: "warn",
    flip: 6750,
  };
  const g = wallEventToGlyph(ev);
  assert.ok(g);
  assert.equal(g!.shape, "flip_triangle");
  assert.equal(g!.strike, 6750);
});

test("trailDerivedGlyphs: birth when trail starts after window edge", () => {
  const glyphs = trailDerivedGlyphs([trail(6800, [100, 115, 130])], "call", 90);
  assert.equal(glyphs.some((g) => g.shape === "birth_tick" && g.strike === 6800), true);
});

test("trailDerivedGlyphs: death on inactive trail", () => {
  const glyphs = trailDerivedGlyphs([trail(6700, [100, 115], false)], "put", 100);
  assert.equal(glyphs.some((g) => g.shape === "death_x"), true);
});

// RED before the fix: a trail whose FIRST point is a reconstructed (modeled) bucket — e.g. the
// modeled prefix mergeModeledUnderlay/backfillRailPrefix inserts before the recorder's first real
// observation — fabricated a "wall forming" glyph for a formation nobody observed. Mirrors the
// `!modeled` guard buildWallBeadMarkers already applies to the bead birth boost.
test("trailDerivedGlyphs: no birth glyph when the trail's first point is modeled (reconstructed)", () => {
  const glyphs = trailDerivedGlyphs(
    [trailWithModeledPoint(6800, [100, 115, 130], 0)],
    "call",
    90
  );
  assert.equal(glyphs.some((g) => g.shape === "birth_tick" && g.strike === 6800), false);
});

// RED before the fix: an inactive trail whose LAST point is modeled fabricated a "wall
// dissolved" glyph for a dissolution nobody observed — mirrors buildWallBeadMarkers' `!modeled`
// guard on the death-bead halo.
test("trailDerivedGlyphs: no death glyph when the trail's last point is modeled (reconstructed)", () => {
  const glyphs = trailDerivedGlyphs(
    [trailWithModeledPoint(6700, [100, 115], 1, false)],
    "put",
    100
  );
  assert.equal(glyphs.some((g) => g.shape === "death_x" && g.strike === 6700), false);
});

// A trail whose LAST point is REAL (observed) still gets its genuine death glyph even though an
// EARLIER point on the same trail is modeled — the guard only looks at the specific boundary
// point in question, so an honest observed dissolution is never suppressed by an unrelated
// modeled bucket elsewhere in the same trail.
test("trailDerivedGlyphs: death still fires when only an earlier point (not the last) is modeled", () => {
  const glyphs = trailDerivedGlyphs(
    [trailWithModeledPoint(6900, [95, 110], 0, false)],
    "put",
    90
  );
  assert.equal(glyphs.some((g) => g.shape === "death_x" && g.strike === 6900), true);
});

test("composeWallEventGlyphs: filters by lens and cursor time", () => {
  const events: VectorWallEvent[] = [
    {
      time: 100,
      lens: "gex",
      kind: "spot_broke_call",
      message: "broke",
      severity: "warn",
      strike: 6800,
      side: "call",
    },
    {
      time: 200,
      lens: "vex",
      kind: "spot_broke_put",
      message: "broke vex",
      severity: "warn",
      strike: 6700,
      side: "put",
    },
  ];
  const composed = composeWallEventGlyphs({
    events,
    callTrails: [],
    putTrails: [],
    lens: "gex",
    earliestBucket: 0,
    cursorTime: 150,
  });
  assert.equal(composed.length, 1);
  assert.equal(composed[0]!.shape, "break_chevron");
});

test("composeWallEventGlyphs: dedupes event + trail glyphs at same time/strike/shape", () => {
  const events: VectorWallEvent[] = [
    {
      time: 100,
      lens: "gex",
      kind: "call_wall_new",
      message: "new",
      severity: "info",
      strike: 6800,
      side: "call",
    },
  ];
  const composed = composeWallEventGlyphs({
    events,
    callTrails: [trail(6800, [100, 115])],
    putTrails: [],
    lens: "gex",
    earliestBucket: 90,
  });
  const births = composed.filter((g) => g.shape === "birth_tick" && g.strike === 6800);
  assert.equal(births.length, 1);
});

test("hitTestProjectedWallEventGlyph: returns nearest glyph within radius", () => {
  const glyphs = [
    { x: 100, y: 200 },
    { x: 300, y: 400 },
  ];
  assert.equal(hitTestProjectedWallEventGlyph(glyphs, 102, 198, 16), 0);
  assert.equal(hitTestProjectedWallEventGlyph(glyphs, 50, 50, 16), -1);
  assert.equal(hitTestProjectedWallEventGlyph(glyphs, 295, 405, 16), 1);
});

test("trailDerivedGlyphs: labels are human-readable", () => {
  const glyphs = trailDerivedGlyphs([trail(6800, [100, 115, 130])], "call", 95);
  const birth = glyphs.find((g) => g.shape === "birth_tick");
  assert.ok(birth?.label.includes("6,800"));
  assert.match(birth!.label, /Call wall forming/i);
});
