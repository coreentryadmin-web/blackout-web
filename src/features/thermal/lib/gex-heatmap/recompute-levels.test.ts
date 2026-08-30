import { test } from "node:test";
import assert from "node:assert/strict";
import { recomputeLevels } from "./recompute-levels";

// Regression: recomputeLevels used to call the UNCONSTRAINED gexWallsFromStrikeTotals (no spot
// param) for the per-expiry-filtered Key Levels row / profile wall markers, reintroducing the
// exact inversion PR #3214 fixed server-side in computeGexRegime -- a call wall landing below
// spot (read as resistance already broken) or a put wall above it (read as support not yet
// reached). Fixture mirrors the live pattern documented on wallsFromStrikeTotals itself: AAPL
// spot 312.66 served call_wall 310 (below spot) when the real above-spot wall was 320.

test("recomputeLevels: call wall is constrained above spot, not the max-magnitude strike anywhere", () => {
  const totals = {
    "300": 1_000_000,
    "310": 2_000_000, // biggest positive total, but BELOW spot
    "320": 1_500_000, // smaller, but the only one above spot
    "330": -500_000,
  };
  const { posWall } = recomputeLevels(totals, 312.66);
  assert.equal(posWall, 320, "call wall must be the largest strike ABOVE spot, not 310 below it");
});

test("recomputeLevels: put wall is constrained below spot, not the max-magnitude strike anywhere", () => {
  const totals = {
    "755": 500_000,
    "760": -1_200_000, // the only negative strike below spot
    "765": -2_000_000, // biggest negative total, but ABOVE spot
  };
  const { negWall } = recomputeLevels(totals, 763.11);
  assert.equal(negWall, 760, "put wall must be the strike BELOW spot, not 765 above it");
});

test("recomputeLevels: no qualifying strike on a side returns null, never a wrong-side fallback", () => {
  // Every negative strike sits ABOVE spot -- there is no put wall below spot in this book.
  const totals = {
    "500": 1_000_000,
    "550": -500_000,
    "560": -300_000,
  };
  const { negWall } = recomputeLevels(totals, 495);
  assert.equal(negWall, null, "must not invent a put wall above spot when none qualifies below it");
});

test("recomputeLevels: invalid spot returns all nulls", () => {
  const totals = { "100": 1, "200": -1 };
  assert.deepEqual(recomputeLevels(totals, 0), { posWall: null, negWall: null, flip: null });
  assert.deepEqual(recomputeLevels(totals, NaN), { posWall: null, negWall: null, flip: null });
});

test("recomputeLevels: flip is the nearest ascending negative-to-positive crossing", () => {
  const totals = {
    "90": -1_000_000,
    "100": 1_000_000, // crossing between 90 and 100
    "110": 2_000_000,
  };
  const { flip } = recomputeLevels(totals, 95);
  assert.equal(flip, 95, "linear interpolation of an equal-magnitude crossing lands at the midpoint");
});
