import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplayTimeline,
  flipAtReplayTime,
  sliceBarsToTime,
  sliceHistoryToTime,
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
