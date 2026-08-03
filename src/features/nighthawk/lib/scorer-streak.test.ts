// Run: node --import tsx --test src/features/nighthawk/lib/scorer-streak.test.ts
//
// NH-R8: the flow-streak bonus used to reward streak_days monotonically with no
// exhaustion — a fresh 5-day streak and a stretched 15-day streak scored
// identically at +12. streakBonusPoints now fades the bonus down (never to zero)
// past STREAK_FADE_START_DAYS.

import assert from "node:assert/strict";
import test from "node:test";
import {
  streakBonusPoints,
  STREAK_FADE_START_DAYS,
  STREAK_FADE_SPAN_DAYS,
  STREAK_EXHAUSTION_FLOOR_MULTIPLIER,
} from "./scorer";

test("below the fade start: unchanged tiered bonus (0/2/3/4-day bands untouched)", () => {
  assert.equal(streakBonusPoints(0, 1), 0);
  assert.equal(streakBonusPoints(1, 1), 0);
  assert.equal(streakBonusPoints(2, 1), 4);
  assert.equal(streakBonusPoints(4, 1), 8);
  assert.equal(streakBonusPoints(5, 1), 12);
  assert.equal(streakBonusPoints(STREAK_FADE_START_DAYS, 1), 12); // exactly at the fade start: still full
});

test("past the fade start: bonus strictly decreases as the streak extends", () => {
  const atStart = streakBonusPoints(STREAK_FADE_START_DAYS, 1);
  const oneOver = streakBonusPoints(STREAK_FADE_START_DAYS + 1, 1);
  const midFade = streakBonusPoints(STREAK_FADE_START_DAYS + Math.round(STREAK_FADE_SPAN_DAYS / 2), 1);
  const fullyFaded = streakBonusPoints(STREAK_FADE_START_DAYS + STREAK_FADE_SPAN_DAYS, 1);
  const wayBeyond = streakBonusPoints(STREAK_FADE_START_DAYS + STREAK_FADE_SPAN_DAYS + 10, 1);
  assert.ok(oneOver < atStart, `${oneOver} vs ${atStart}`);
  assert.ok(midFade < oneOver, `${midFade} vs ${oneOver}`);
  assert.ok(fullyFaded <= midFade, `${fullyFaded} vs ${midFade}`);
  // Floor: never fades below the documented floor multiplier, and never below it
  // even for an absurdly long streak (fade span is capped, not unbounded).
  assert.equal(fullyFaded, Math.round(12 * STREAK_EXHAUSTION_FLOOR_MULTIPLIER));
  assert.equal(wayBeyond, fullyFaded);
});

test("exhaustion never reaches zero: a long streak is still real corroborating evidence, just discounted", () => {
  const veryLong = streakBonusPoints(60, 1);
  assert.ok(veryLong > 0, `veryLong ${veryLong}`);
  assert.equal(veryLong, Math.round(12 * STREAK_EXHAUSTION_FLOOR_MULTIPLIER));
});

test("streakWeight still scales the (possibly faded) base", () => {
  const base = streakBonusPoints(STREAK_FADE_START_DAYS + STREAK_FADE_SPAN_DAYS, 1);
  const weighted = streakBonusPoints(STREAK_FADE_START_DAYS + STREAK_FADE_SPAN_DAYS, 2);
  assert.equal(weighted, Math.round(base * 2));
});
