import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adaptiveBarSpacingForZoom,
  coarserTimeframeIfZoomedOut,
  hasExtendedHoursBars,
  liveEdgeVisibleLogicalRange,
  overlayDimFactor,
  structureVisibleLogicalRange,
  toCandlestickDisplayData,
  visibleBarCountFromRange,
  volumeAlphaForBar,
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

  test("overlayDimFactor: compare 4-up baseline dim on focused and background panes", () => {
    assert.equal(overlayDimFactor(60, { compareFourUp: true }), 0.88);
    assert.equal(overlayDimFactor(60, { compareFourUpBackground: true }), 0.72);
    assert.ok(overlayDimFactor(200, { compareFourUpBackground: true }) < overlayDimFactor(200, { compareFourUp: true }));
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

  test("hasExtendedHoursBars: detects pre/post-market in a mixed seed", () => {
    const etSec = (h: number, m: number) => Date.UTC(2026, 7, 5, h + 4, m, 0) / 1000;
    assert.equal(hasExtendedHoursBars([{ time: etSec(10, 0) }]), false);
    assert.equal(
      hasExtendedHoursBars([{ time: etSec(10, 0) }, { time: etSec(4, 0) }]),
      true
    );
  });

  test("toCandlestickDisplayData: dims only extended-hours bars", () => {
    const etSec = (h: number, m: number) => Date.UTC(2026, 7, 5, h + 4, m, 0) / 1000;
    const bars = [
      { time: etSec(4, 0), open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: etSec(10, 0), open: 2, high: 3, low: 1.5, close: 2.5 },
    ];
    const out = toCandlestickDisplayData(bars);
    assert.equal(out[0]!.color?.includes("rgba"), true);
    assert.equal(out[1]!.color, undefined);
  });

  test("toCandlestickDisplayData: all-RTH seed passes through unchanged", () => {
    const etSec = (h: number, m: number) => Date.UTC(2026, 7, 5, h + 4, m, 0) / 1000;
    const bars = [{ time: etSec(10, 0), open: 1, high: 2, low: 1, close: 1.5 }];
    const out = toCandlestickDisplayData(bars);
    assert.equal(out[0]!.color, undefined);
  });

  test("volumeAlphaForBar: lower alpha outside RTH when extended hours present", () => {
    const etSec = (h: number, m: number) => Date.UTC(2026, 7, 5, h + 4, m, 0) / 1000;
    assert.equal(volumeAlphaForBar(etSec(10, 0), true), 0.72);
    assert.equal(volumeAlphaForBar(etSec(4, 0), true), 0.26);
    assert.equal(volumeAlphaForBar(etSec(4, 0), false), 0.72);
  });
});
