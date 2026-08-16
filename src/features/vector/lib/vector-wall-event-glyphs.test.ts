import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHART_GLYPH_EVENT_KINDS,
  composeWallEventGlyphs,
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
