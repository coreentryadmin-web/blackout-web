import test from "node:test";
import assert from "node:assert/strict";
import {
  VECTOR_BASE_RIGHT_OFFSET_BARS,
  VECTOR_VP_MAX_BAND_PX,
  VECTOR_VP_RIGHT_OFFSET_PX,
  vectorChartTimeScaleGutter,
  volumeProfileBarRect,
  volumeProfileGutter,
  VP_CANDLE_GAP_PX,
} from "./vector-volume-profile-layout";

test("vectorChartTimeScaleGutter: pixel gutter when VP on, bar offset when off", () => {
  assert.deepEqual(vectorChartTimeScaleGutter(false), { rightOffset: VECTOR_BASE_RIGHT_OFFSET_BARS });
  assert.deepEqual(vectorChartTimeScaleGutter(true), { rightOffsetPixels: VECTOR_VP_RIGHT_OFFSET_PX });
});

test("volumeProfileGutter: reserves space only to the right of the last candle, below the band cap", () => {
  const lastX = 1100;
  const gutter = volumeProfileGutter(1200, lastX);
  assert.ok(gutter);
  assert.equal(gutter!.rightX, 1198);
  assert.equal(gutter!.maxBarWidth, 1198 - (lastX + VP_CANDLE_GAP_PX));
  assert.equal(gutter!.gutterLeft, lastX + VP_CANDLE_GAP_PX);
});

test("volumeProfileGutter: caps the band so it never dominates the pane, however much whitespace exists", () => {
  // BUG FIXED (2026-08-26, live member report): outside RTH the last candle can sit far left of
  // the price axis (the time window still reserves room for the next session), leaving hundreds
  // of px of raw whitespace. The band must stay capped at VECTOR_VP_MAX_BAND_PX regardless — this
  // is an ambient background reference, not a competing foreground element.
  const lastX = 300;
  const gutter = volumeProfileGutter(1200, lastX);
  assert.ok(gutter);
  const rawBand = 1198 - (lastX + VP_CANDLE_GAP_PX);
  assert.ok(rawBand > VECTOR_VP_MAX_BAND_PX, "test fixture must actually exercise the cap");
  assert.equal(gutter!.maxBarWidth, VECTOR_VP_MAX_BAND_PX);
  // Bars stay anchored to the price axis — capping only pulls the far (left) edge inward.
  assert.equal(gutter!.rightX, 1198);
  assert.equal(gutter!.gutterLeft, gutter!.rightX - VECTOR_VP_MAX_BAND_PX);
});

test("volumeProfileGutter: null when the last candle sits flush to the right edge", () => {
  assert.equal(volumeProfileGutter(400, 395), null);
});

test("volumeProfileBarRect: bars grow from the right edge inward, never past gutterLeft", () => {
  const gutter = volumeProfileGutter(1000, 820)!;
  const full = volumeProfileBarRect(gutter, 1)!;
  assert.ok(full);
  assert.equal(full.xLeft, gutter.gutterLeft);
  assert.equal(full.width, gutter.maxBarWidth);

  const half = volumeProfileBarRect(gutter, 0.5)!;
  assert.ok(half);
  assert.ok(half.xLeft > gutter.gutterLeft);
  assert.equal(half.xLeft + half.width, gutter.rightX);
});
