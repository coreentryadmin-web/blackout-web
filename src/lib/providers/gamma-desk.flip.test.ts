import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGammaFlip } from "./gamma-desk";

// Unified 2026-07-21: computeGammaFlip delegates to the shared cumulativeGammaFlip — the
// SpotGamma cumulative zero-gamma boundary (the net-short→net-long crossing nearest spot, with a
// ±12% plausibility band, and null when the book never turns net-long). These guard that unified
// behavior on the desk. Ladders start net-short below spot (as real chains do: OTM puts carry
// negative dealer gamma), so the cumulative sum begins negative and the short→long crossing is the
// regime boundary. The old desk-local impl detected both-direction crossings + terminal zero
// touches; those cases (a tangent touch, a long→short crossing) are intentionally no longer flips.

test("net-short→net-long crossing interpolates within the bracket, nearest spot", () => {
  // cum: -10 at 100, then -10 + 20 = +10 at 110 → crosses zero at 105 (mid), inside ±12% of spot.
  const levels = [
    { strike: 100, net_gex: -10 },
    { strike: 110, net_gex: 20 },
  ];
  const flip = computeGammaFlip(levels, 105);
  assert.ok(flip !== null && flip > 100 && flip < 110);
});

test("net-short-everywhere book → null (no long-gamma regime; never fabricates a flip)", () => {
  // cumulative stays ≤0 (-10, -25) → dealers short gamma throughout → honest null.
  const levels = [
    { strike: 100, net_gex: -10 },
    { strike: 110, net_gex: -15 },
  ];
  assert.equal(computeGammaFlip(levels, 105), null);
});

test("crossing outside the ±12% plausibility band → null (thin-far-strike artifact rejected)", () => {
  // the only short→long crossing sits ~105, but spot is 300 → >12% away → rejected.
  const levels = [
    { strike: 100, net_gex: -10 },
    { strike: 110, net_gex: 20 },
  ];
  assert.equal(computeGammaFlip(levels, 300), null);
});

test("empty input returns null", () => {
  assert.equal(computeGammaFlip([], 100), null);
});
