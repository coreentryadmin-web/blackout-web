import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vectorComparePerfPollMs,
  vectorWallsScopePollMs,
  VECTOR_COMPARE_FOUR_UP_POLL_MULTIPLIER,
  liveTickDisplayRecomputeDue,
  VECTOR_LIVE_TICK_DISPLAY_RECOMPUTE_THROTTLE_MS,
} from "./vector-cadence";

test("vectorWallsScopePollMs: oracle + shared universe 5s, on-demand 15s", () => {
  assert.equal(vectorWallsScopePollMs("SPX"), 5_000);
  assert.equal(vectorWallsScopePollMs("META"), 5_000);
  assert.equal(vectorWallsScopePollMs("NVDA"), 5_000);
  assert.equal(vectorWallsScopePollMs("ZZZZ"), 15_000);
});

test("vectorComparePerfPollMs: doubles cadence for 4-up background panes", () => {
  assert.equal(vectorComparePerfPollMs(5_000, false), 5_000);
  assert.equal(vectorComparePerfPollMs(5_000, true), 5_000 * VECTOR_COMPARE_FOUR_UP_POLL_MULTIPLIER);
});

test("liveTickDisplayRecomputeDue: blocks a tick arriving before the throttle window elapses", () => {
  const last = 10_000;
  assert.equal(liveTickDisplayRecomputeDue(last, last), false);
  assert.equal(liveTickDisplayRecomputeDue(last, last + 1), false);
  assert.equal(
    liveTickDisplayRecomputeDue(last, last + VECTOR_LIVE_TICK_DISPLAY_RECOMPUTE_THROTTLE_MS - 1),
    false
  );
});

test("liveTickDisplayRecomputeDue: allows a tick once the throttle window has elapsed", () => {
  const last = 10_000;
  assert.equal(
    liveTickDisplayRecomputeDue(last, last + VECTOR_LIVE_TICK_DISPLAY_RECOMPUTE_THROTTLE_MS),
    true
  );
  assert.equal(
    liveTickDisplayRecomputeDue(last, last + VECTOR_LIVE_TICK_DISPLAY_RECOMPUTE_THROTTLE_MS + 500),
    true
  );
});

test("liveTickDisplayRecomputeDue: first-ever tick (lastRecomputeAtMs=0) always fires at real Date.now() scale", () => {
  // The ref starts at 0 and is only ever compared against a real Date.now() epoch (always far
  // larger than the throttle window), never against another small fake value — a tiny `nowMs`
  // like 1ms is not a realistic first call and would correctly still be throttled.
  assert.equal(liveTickDisplayRecomputeDue(0, Date.now()), true);
});

test("liveTickDisplayRecomputeDue: a burst of sub-throttle ticks only recomputes once", () => {
  // Simulates the real failure mode: SSE ticks arriving far faster than the throttle window.
  let lastRecomputeAt = 0;
  let recomputeCount = 0;
  const tickTimesMs = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220];
  for (const now of tickTimesMs) {
    if (liveTickDisplayRecomputeDue(lastRecomputeAt, now)) {
      lastRecomputeAt = now;
      recomputeCount++;
    }
  }
  // 12 ticks at 20ms spacing (240ms span) under a 200ms throttle should recompute at most twice
  // (t=0 and t=200/220), never once per tick.
  assert.ok(
    recomputeCount <= 2,
    `expected at most 2 recomputes across a 240ms burst of 20ms-spaced ticks, got ${recomputeCount}`
  );
  assert.ok(recomputeCount >= 1, "the first tick in a burst must always recompute");
});
