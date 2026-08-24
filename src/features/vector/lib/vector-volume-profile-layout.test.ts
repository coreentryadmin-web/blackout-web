import test from "node:test";
import assert from "node:assert/strict";
import {
  VECTOR_BASE_RIGHT_OFFSET_BARS,
  VECTOR_VP_RIGHT_OFFSET_BARS,
  vectorChartRightOffsetBars,
  volumeProfileBarRect,
  volumeProfileGutter,
  VP_CANDLE_GAP_PX,
} from "./vector-volume-profile-layout";

test("vectorChartRightOffsetBars: wider gutter when session volume profile is on", () => {
  assert.equal(vectorChartRightOffsetBars(false), VECTOR_BASE_RIGHT_OFFSET_BARS);
  assert.equal(vectorChartRightOffsetBars(true), VECTOR_VP_RIGHT_OFFSET_BARS);
  assert.ok(VECTOR_VP_RIGHT_OFFSET_BARS > VECTOR_BASE_RIGHT_OFFSET_BARS);
});

test("volumeProfileGutter: reserves space only to the right of the last candle", () => {
  const lastX = 900;
  const gutter = volumeProfileGutter(1200, lastX);
  assert.ok(gutter);
  assert.equal(gutter!.gutterLeft, lastX + VP_CANDLE_GAP_PX);
  assert.equal(gutter!.rightX, 1198);
  assert.equal(gutter!.maxBarWidth, 1198 - (lastX + VP_CANDLE_GAP_PX));
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
