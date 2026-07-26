import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gammaRegimeGeometry,
  zoneGradientStops,
  regimePostureLabel,
  LONG_GAMMA_RGB,
  SHORT_GAMMA_RGB,
} from "./vector-gamma-regime-paint";

test("regimePostureLabel maps the flip side to the dealer-gamma posture", () => {
  assert.equal(regimePostureLabel(true), "LONG γ");
  assert.equal(regimePostureLabel(false), "SHORT γ");
});

test("null / non-finite flip → no geometry (draw nothing, never fabricate a regime)", () => {
  assert.equal(gammaRegimeGeometry({ flip: null, spot: 100, flipY: 200 }), null);
  assert.equal(gammaRegimeGeometry({ flip: Number.NaN, spot: 100, flipY: 200 }), null);
  assert.equal(gammaRegimeGeometry({ flip: Infinity, spot: 100, flipY: 200 }), null);
});

test("unavailable flip coordinate → no geometry", () => {
  assert.equal(gammaRegimeGeometry({ flip: 100, spot: 100, flipY: null }), null);
  assert.equal(gammaRegimeGeometry({ flip: 100, spot: 100, flipY: Number.NaN }), null);
});

test("non-positive extent / peak alpha → no geometry", () => {
  assert.equal(gammaRegimeGeometry({ flip: 100, spot: 100, flipY: 200, extentPx: 0 }), null);
  assert.equal(gammaRegimeGeometry({ flip: 100, spot: 100, flipY: 200, peakAlpha: 0 }), null);
});

test("spot ABOVE flip → long-gamma (calm) side active + brighter, warm side dimmed", () => {
  const geo = gammaRegimeGeometry({ flip: 100, spot: 105, flipY: 200, extentPx: 50, peakAlpha: 0.12 });
  assert.ok(geo);
  // Zones fixed by geometry: teal above the flip, amber below.
  assert.equal(geo!.above.rgb, LONG_GAMMA_RGB);
  assert.equal(geo!.below.rgb, SHORT_GAMMA_RGB);
  assert.equal(geo!.above.posture, "long");
  assert.equal(geo!.below.posture, "short");
  // Spot in the calm zone → long-γ active + at full peak, short-γ dimmed.
  assert.equal(geo!.above.active, true);
  assert.equal(geo!.below.active, false);
  assert.equal(geo!.above.peakAlpha, 0.12);
  assert.ok(geo!.below.peakAlpha < geo!.above.peakAlpha);
  // Extent geometry: glow reaches extentPx each side of the flip's y.
  assert.equal(geo!.flipY, 200);
  assert.equal(geo!.topY, 150);
  assert.equal(geo!.bottomY, 250);
});

test("spot BELOW flip → short-gamma (unstable) side active + brighter, calm side dimmed", () => {
  const geo = gammaRegimeGeometry({ flip: 100, spot: 95, flipY: 200, extentPx: 50, peakAlpha: 0.12 });
  assert.ok(geo);
  assert.equal(geo!.below.active, true);
  assert.equal(geo!.above.active, false);
  assert.equal(geo!.below.peakAlpha, 0.12);
  assert.ok(geo!.above.peakAlpha < geo!.below.peakAlpha);
});

test("spot exactly AT the flip counts as the long-gamma (>=) side", () => {
  const geo = gammaRegimeGeometry({ flip: 100, spot: 100, flipY: 200 });
  assert.ok(geo);
  assert.equal(geo!.above.active, true);
  assert.equal(geo!.below.active, false);
});

test("null spot → boundary still draws, both sides equal (no side to confirm)", () => {
  const geo = gammaRegimeGeometry({ flip: 100, spot: null, flipY: 200, peakAlpha: 0.12 });
  assert.ok(geo);
  assert.equal(geo!.above.active, false);
  assert.equal(geo!.below.active, false);
  assert.equal(geo!.above.peakAlpha, 0.12);
  assert.equal(geo!.below.peakAlpha, 0.12);
});

test("zoneGradientStops: peak sits at the flip, fades to 0 at the outer edge", () => {
  const geo = gammaRegimeGeometry({ flip: 100, spot: 105, flipY: 200, peakAlpha: 0.12 });
  assert.ok(geo);
  // Above zone: gradient runs top(0) → flip(1); peak alpha at offset 1 (the flip), transparent at 0.
  const above = zoneGradientStops(geo!.above, "above");
  assert.equal(above[0]!.offset, 0);
  assert.match(above[0]!.color, /rgba\(45, 212, 191, 0\)/);
  assert.equal(above[1]!.offset, 1);
  assert.match(above[1]!.color, /rgba\(45, 212, 191, 0\.12\)/);
  // Below zone: gradient runs flip(0) → bottom(1); peak at offset 0 (the flip), transparent at 1.
  const below = zoneGradientStops(geo!.below, "below");
  assert.equal(below[0]!.offset, 0);
  assert.match(below[0]!.color, /rgba\(251, 146, 60, /);
  assert.match(below[1]!.color, /rgba\(251, 146, 60, 0\)/);
});
