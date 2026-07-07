import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplayTimeline,
  flipAtCrosshairTime,
  flipAtReplayTime,
  sliceBarsToTime,
  sliceHistoryToTime,
  wallsAtCrosshairTime,
  wallsAtReplayTime,
} from "@/lib/vector-replay";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "@/lib/providers/vector-wall-history";

function walls(call: number, put: number): GexWalls {
  return {
    callWalls: [{ strike: call, pct: 10 }],
    putWalls: [{ strike: put, pct: 8 }],
  };
}

test("buildReplayTimeline: unions wall + bar times sorted", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls(6800, 6700) },
    { time: 115, walls: walls(6810, 6700) },
  ];
  const bars = [{ time: 60, open: 1, high: 1, low: 1, close: 1 }];
  assert.deepEqual(buildReplayTimeline(history, bars), [60, 100, 115]);
});

test("sliceHistoryToTime + wallsAtReplayTime", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls(6800, 6700) },
    { time: 130, walls: walls(6810, 6700) },
    { time: 145, walls: walls(6820, 6700) },
  ];
  assert.equal(sliceHistoryToTime(history, 130).length, 2);
  assert.equal(wallsAtReplayTime(history, 120)?.callWalls[0].strike, 6800);
  assert.equal(wallsAtReplayTime(history, 140)?.callWalls[0].strike, 6810);
});

test("sliceBarsToTime", () => {
  const bars = [
    { time: 60, open: 1, high: 1, low: 1, close: 1 },
    { time: 120, open: 2, high: 2, low: 2, close: 2 },
    { time: 180, open: 3, high: 3, low: 3, close: 3 },
  ];
  assert.equal(sliceBarsToTime(bars, 120).length, 2);
});

test("flipAtReplayTime: latest flip at or before cursor", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls(6800, 6700), gammaFlip: 6740 },
    { time: 130, walls: walls(6810, 6700), gammaFlip: 6755 },
  ];
  assert.equal(flipAtReplayTime(history, 120, "gex"), 6740);
  assert.equal(flipAtReplayTime(history, 130, "gex"), 6755);
});

// Regression: hovering/scrubbing the Vector chart at a time BEFORE the earliest recorded
// wall sample used to silently fall back to today's LIVE wall/flip state, mislabeling it as
// the historical state at the hovered time — same bug shape as the 0DTE TRIM narrative fix
// (a stale/absent value masquerading as current). wallsAtReplayTime/flipAtReplayTime are
// honest (return null when the cursor predates all samples); the bug was in these callers'
// "?? live" fallback treating that null the same as "no history exists at all."
const LIVE = walls(7600, 7400);
const SAMPLE = walls(7550, 7450);
const HISTORY: WallHistorySample[] = [
  { time: 1000, walls: SAMPLE, gammaFlip: 7500 },
  { time: 2000, walls: SAMPLE, gammaFlip: 7505 },
];

test("wallsAtCrosshairTime: hovering before the earliest sample returns null, not today's live walls", () => {
  const result = wallsAtCrosshairTime(HISTORY, 500 /* before HISTORY[0].time */, "gex", LIVE, null);
  assert.equal(result, null);
});

test("wallsAtCrosshairTime: hovering at/after a recorded sample returns that historical sample, not live", () => {
  const result = wallsAtCrosshairTime(HISTORY, 1500, "gex", LIVE, null);
  assert.deepEqual(result, SAMPLE);
  assert.notDeepEqual(result, LIVE);
});

test("wallsAtCrosshairTime: crosshair off the chart (hoverEpochSec null) falls back to live", () => {
  const result = wallsAtCrosshairTime(HISTORY, null, "gex", LIVE, null);
  assert.deepEqual(result, LIVE);
});

test("wallsAtCrosshairTime: zero history ever recorded falls back to live — nothing else to show", () => {
  const result = wallsAtCrosshairTime([], 1500, "gex", LIVE, null);
  assert.deepEqual(result, LIVE);
});

test("flipAtCrosshairTime: hovering before the earliest sample returns null, not today's live flip", () => {
  const flip = flipAtCrosshairTime(HISTORY, 500, "gex", 7777, null);
  assert.equal(flip, null);
});

test("flipAtCrosshairTime: hovering at/after a recorded sample returns that historical flip, not live", () => {
  const flip = flipAtCrosshairTime(HISTORY, 1500, "gex", 7777, null);
  assert.equal(flip, 7500);
});
