import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGammaMagnet } from "./vector-gamma-magnet";
import type { VectorWalls } from "@/lib/api";

const walls: VectorWalls = {
  callWalls: [
    { strike: 7600, pct: 100 },
    { strike: 7650, pct: 40 },
  ],
  putWalls: [
    { strike: 7500, pct: 80 },
    { strike: 7450, pct: 20 },
  ],
};

test("deriveGammaMagnet: strength-weighted center of mass of the walls", () => {
  const m = deriveGammaMagnet({ spot: 7550, walls, posture: "long" });
  assert.ok(m);
  // (7600*100 + 7650*40 + 7500*80 + 7450*20) / 240 = 1,815,000 / 240 = 7562.5
  assert.equal(m!.strike, 7562.5);
  assert.equal(m!.pull, "up", "magnet sits above spot 7550");
  assert.ok(m!.distancePct > 0);
});

test("deriveGammaMagnet: LONG gamma phrases it as a magnet/pin", () => {
  const m = deriveGammaMagnet({ spot: 7550, walls, posture: "long" });
  assert.match(m!.callout, /gamma magnet/);
  assert.match(m!.callout, /pull(s)? spot up/);
});

test("deriveGammaMagnet: SHORT gamma phrases the SAME level as a pivot (no false pin claim)", () => {
  const m = deriveGammaMagnet({ spot: 7550, walls, posture: "short" });
  assert.equal(m!.strike, 7562.5, "same center of mass regardless of posture");
  assert.match(m!.callout, /gamma pivot/);
  assert.doesNotMatch(m!.callout, /magnet|pin/, "must NOT claim a pin in short gamma");
});

test("deriveGammaMagnet: 'at' when spot sits on the magnet (within dead-band)", () => {
  const m = deriveGammaMagnet({ spot: 7562.5, walls, posture: "long" });
  assert.equal(m!.pull, "at");
  assert.match(m!.callout, /pinned/);
});

test("deriveGammaMagnet: unknown posture → neutral center-of-mass phrasing", () => {
  const m = deriveGammaMagnet({ spot: 7550, walls });
  assert.equal(m!.posture, "unknown");
  assert.match(m!.callout, /center of mass/);
});

// BUG FIX (2026-10-24, Ask Largo fan-out audit, live repro BMNR): buildCallout used to receive
// Math.round(strike) (whole-dollar level) while distancePct (passed alongside it in the SAME
// sentence) was computed from the un-rounded, cents-precision strike -- whenever the weighted
// magnet strike wasn't already near-integer (the ordinary case), the callout's level and its own
// quoted percent described two DIFFERENT numbers. Live repro: spot 22.41, callout read "gamma
// pivot 31 (+36.86%)" -- (31-22.41)/22.41 = +38.33%, not +36.86%; +36.86% is the percent for the
// REAL strike, 30.67 -- exactly what `strike`/`distancePct` on this same object already carry.
test("deriveGammaMagnet: callout's level and percent describe the SAME number, never Math.round(strike) paired with the unrounded strike's percent (live repro BMNR, 2026-10-24)", () => {
  const bmnrWalls: VectorWalls = {
    callWalls: [{ strike: 30, pct: 50 }],
    putWalls: [{ strike: 31.34, pct: 50 }],
  };
  const m = deriveGammaMagnet({ spot: 22.41, walls: bmnrWalls, posture: "short" });
  assert.ok(m);
  assert.equal(m!.strike, 30.67, "sanity: reproduces the live BMNR magnet strike exactly");

  const expectedPct = ((m!.strike - 22.41) / 22.41) * 100;
  assert.match(
    m!.callout,
    new RegExp(`30\\.67.*\\+${expectedPct.toFixed(2)}%`),
    `callout must cite the same cents-precision level (30.67) its own percent was computed from — got: ${m!.callout}`
  );
  assert.doesNotMatch(
    m!.callout,
    /\b31\b/,
    `callout must not cite a different, whole-dollar level (31) than m.strike (30.67) — got: ${m!.callout}`
  );
});

test("deriveGammaMagnet: null on no spot / no walls / zero-weight walls — never fabricates", () => {
  assert.equal(deriveGammaMagnet({ spot: 0, walls, posture: "long" }), null);
  assert.equal(deriveGammaMagnet({ spot: 7550, walls: null }), null);
  assert.equal(deriveGammaMagnet({ spot: 7550, walls: { callWalls: [], putWalls: [] } }), null);
  assert.equal(
    deriveGammaMagnet({ spot: 7550, walls: { callWalls: [{ strike: 7600, pct: 0 }], putWalls: [] } }),
    null,
    "zero total strength → no honest magnet"
  );
});
