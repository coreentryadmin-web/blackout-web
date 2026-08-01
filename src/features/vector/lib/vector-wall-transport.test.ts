import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trimWallHistoryForTransport,
  trimWallHistorySampleForTransport,
  VECTOR_TRANSPORT_WALLS_PER_SIDE,
} from "./vector-wall-transport";
import type { WallHistorySample } from "./vector-wall-history";

function sampleWithDepth(n: number): WallHistorySample {
  return {
    time: 1,
    walls: {
      callWalls: Array.from({ length: n }, (_, i) => ({ strike: 5000 + i, pct: 10 - i })),
      putWalls: Array.from({ length: n }, (_, i) => ({ strike: 4900 - i, pct: 8 - i })),
    },
    vexWalls: {
      callWalls: Array.from({ length: n }, (_, i) => ({ strike: 5010 + i, pct: 5 - i })),
      putWalls: Array.from({ length: n }, (_, i) => ({ strike: 4890 - i, pct: 4 - i })),
    },
  };
}

test("trimWallHistorySampleForTransport caps ladder depth to dominance count", () => {
  const trimmed = trimWallHistorySampleForTransport(sampleWithDepth(20));
  assert.equal(trimmed.walls.callWalls.length, VECTOR_TRANSPORT_WALLS_PER_SIDE);
  assert.equal(trimmed.walls.putWalls.length, VECTOR_TRANSPORT_WALLS_PER_SIDE);
  assert.equal(trimmed.vexWalls?.callWalls.length, VECTOR_TRANSPORT_WALLS_PER_SIDE);
  assert.equal(trimmed.vexWalls?.putWalls.length, VECTOR_TRANSPORT_WALLS_PER_SIDE);
  assert.equal(trimmed.walls.callWalls[0]?.strike, 5000);
});

test("trimWallHistoryForTransport keeps timeline but can tail-cap sample count", () => {
  const history = Array.from({ length: 10 }, (_, i) => ({
    ...sampleWithDepth(12),
    time: i + 1,
  }));
  const tail = trimWallHistoryForTransport(history, { maxSamples: 4 });
  assert.equal(tail.length, 4);
  assert.deepEqual(
    tail.map((s) => s.time),
    [7, 8, 9, 10]
  );
});

test("trimWallHistoryForTransport preserves full session when no maxSamples", () => {
  const history = Array.from({ length: 5 }, (_, i) => ({
    ...sampleWithDepth(12),
    time: i,
  }));
  assert.equal(trimWallHistoryForTransport(history).length, 5);
});
