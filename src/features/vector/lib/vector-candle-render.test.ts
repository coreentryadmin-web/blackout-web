import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adaptiveBarSpacingForZoom,
  applyAdaptiveBarSpacingToChart,
  beadOverlayDimFactor,
  BEAD_OVERLAY_DIM_FLOOR,
  BEAD_OVERLAY_DIM_FLOOR_COMPARE,
  coarserTimeframeIfZoomedOut,
  hasExtendedHoursBars,
  intradayZoomPresetFromKeyboard,
  intradayZoomShortcutLabel,
  centeredLiveVisibleLogicalRange,
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

  test("beadOverlayDimFactor: floor keeps beads legible on full-session overview", () => {
    assert.ok(beadOverlayDimFactor(390) >= BEAD_OVERLAY_DIM_FLOOR);
    assert.ok(
      beadOverlayDimFactor(200, { compareCompactBeads: true }) >= BEAD_OVERLAY_DIM_FLOOR_COMPARE
    );
  });

  test("adaptiveBarSpacingForZoom: widens spacing when few bars visible", () => {
    const tight = adaptiveBarSpacingForZoom(30);
    assert.ok(tight.barSpacing > VECTOR_SESSION_BAR_SPACING);
    assert.equal(tight.minBarSpacing, VECTOR_MIN_BAR_SPACING);
    const wide = adaptiveBarSpacingForZoom(250);
    assert.equal(wide.minBarSpacing, VECTOR_MIN_BAR_SPACING);
  });

  test("applyAdaptiveBarSpacingToChart: applies spacing from visible logical range", () => {
    let applied: { barSpacing: number; minBarSpacing: number } | null = null;
    const chart = {
      timeScale: () => ({
        getVisibleLogicalRange: () => ({ from: 0, to: 50 }),
        applyOptions: (o: { barSpacing: number; minBarSpacing: number }) => {
          applied = o;
        },
      }),
    };
    applyAdaptiveBarSpacingToChart(chart);
    assert.ok(applied);
    assert.equal(applied!.barSpacing, VECTOR_SESSION_BAR_SPACING);
  });

  test("structure and live zoom presets frame trailing windows", () => {
    assert.deepEqual(structureVisibleLogicalRange(200), { from: 125, to: 201 });
    assert.deepEqual(liveEdgeVisibleLogicalRange(100), { from: 52, to: 101 });
    assert.deepEqual(structureVisibleLogicalRange(10), { from: 0, to: 11 });
  });

  test("centeredLiveVisibleLogicalRange: latest bar sits near horizontal center", () => {
    const range = centeredLiveVisibleLogicalRange(100);
    assert.ok(range);
    const mid = (range!.from + range!.to) / 2;
    assert.ok(Math.abs(mid - 99) <= 2, `expected center near bar 99, got mid=${mid}`);
    assert.equal(range!.to - range!.from, 49);
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

  test("intradayZoomPresetFromKeyboard: desk uses 1/2/3, compare uses Shift+1/2/3 on focused pane", () => {
    const desk = { comparePane: false, compareKeyboardActive: true, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false };
    assert.equal(intradayZoomPresetFromKeyboard("1", desk), "session");
    assert.equal(intradayZoomPresetFromKeyboard("3", desk), "live");
    assert.equal(intradayZoomPresetFromKeyboard("3", { ...desk, shiftKey: true }), null);

    const compare = { comparePane: true, compareKeyboardActive: true, shiftKey: true, metaKey: false, ctrlKey: false, altKey: false };
    assert.equal(intradayZoomPresetFromKeyboard("2", compare), "structure");
    assert.equal(intradayZoomPresetFromKeyboard("2", { ...compare, shiftKey: false }), null);
    assert.equal(intradayZoomPresetFromKeyboard("2", { ...compare, compareKeyboardActive: false }), null);
  });

  test("intradayZoomShortcutLabel: shows modifier in compare", () => {
    assert.equal(intradayZoomShortcutLabel("live", false), "3");
    assert.equal(intradayZoomShortcutLabel("live", true), "Shift+3");
  });
});
