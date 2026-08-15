import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINKED_REPLAY_STEP_MS,
  linkedReplayClockLabel,
  mergeReplayTimelines,
} from "./vector-compare-replay";
import { timelineIndexAtOrBeforeTime } from "./vector-replay";

test("mergeReplayTimelines unions and sorts epoch steps", () => {
  const merged = mergeReplayTimelines([
    [100, 200, 400],
    [150, 200, 300],
  ]);
  assert.deepEqual(merged, [100, 150, 200, 300, 400]);
});

test("timelineIndexAtOrBeforeTime picks the last step at or before cursor", () => {
  const tl = [100, 200, 300];
  assert.equal(timelineIndexAtOrBeforeTime(tl, 50), 0);
  assert.equal(timelineIndexAtOrBeforeTime(tl, 200), 1);
  assert.equal(timelineIndexAtOrBeforeTime(tl, 250), 1);
  assert.equal(timelineIndexAtOrBeforeTime(tl, 900), 2);
});

test("linkedReplayClockLabel formats union step", () => {
  const label = linkedReplayClockLabel([1_704_000_000], 0);
  assert.match(label, /\d/);
});

test("LINKED_REPLAY_STEP_MS matches chart replay cadence", () => {
  assert.equal(LINKED_REPLAY_STEP_MS, 350);
});
