import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adaptiveBarSpacingForZoom,
  coarserTimeframeIfZoomedOut,
  liveEdgeVisibleLogicalRange,
  overlayDimFactor,
  structureVisibleLogicalRange,
  visibleBarCountFromRange,
  VECTOR_MIN_BAR_SPACING,
  VECTOR_SESSION_BAR_SPACING,
} from "./vector-candle-render";

describe("vector-candle-render", () => {
  test("visibleBarCountFromRange: counts logical span", () => {
    assert.equal(visibleBarCountFromRange({ from: 0, to: 90 }), 90);
    assert.equal(visibleBarCountFromRange(null), null);
  });

  test("overlayDimFactor: full opacity when zoomed in, dims when zoomed out", () => {
    assert.equal(overlayDimFactor(60), 1);
    assert.equal(overlayDimFactor(90), 1);
    assert.ok(overlayDimFactor(200) < 1 && overlayDimFactor(200) > 0.5);
    assert.equal(overlayDimFactor(400), 0.38);
  });

  test("adaptiveBarSpacingForZoom: widens spacing when few bars visible", () => {
    const tight = adaptiveBarSpacingForZoom(30);
    assert.ok(tight.barSpacing > VECTOR_SESSION_BAR_SPACING);
    assert.equal(tight.minBarSpacing, VECTOR_MIN_BAR_SPACING);
    const wide = adaptiveBarSpacingForZoom(250);
    assert.equal(wide.minBarSpacing, VECTOR_MIN_BAR_SPACING);
  });

  test("structure and live zoom presets frame trailing windows", () => {
    assert.deepEqual(structureVisibleLogicalRange(200), { from: 125, to: 201 });
    assert.deepEqual(liveEdgeVisibleLogicalRange(100), { from: 52, to: 101 });
    assert.deepEqual(structureVisibleLogicalRange(10), { from: 0, to: 11 });
  });

  test("coarserTimeframeIfZoomedOut: steps up preset when equivalent 1m bars exceed threshold", () => {
    assert.equal(coarserTimeframeIfZoomedOut(50, 1), null);
    assert.equal(coarserTimeframeIfZoomedOut(350, 1), 3);
    assert.equal(coarserTimeframeIfZoomedOut(120, 3), 5);
    assert.equal(coarserTimeframeIfZoomedOut(200, 60), null);
  });
});
