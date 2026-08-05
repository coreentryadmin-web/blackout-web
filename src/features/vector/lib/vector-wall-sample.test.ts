import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketWallSampleTime,
  buildWallHistorySample,
  NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
  ORACLE_WALL_TRAIL_SAMPLE_SEC,
  UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
  wallTrailSampleSecForTicker,
  vectorWallTrailSecClient,
} from "./vector-wall-sample";

test("bucketWallSampleTime: snaps to 15s floor", () => {
  assert.equal(bucketWallSampleTime(100, 15), 90);
  assert.equal(bucketWallSampleTime(105, 15), 105);
  assert.equal(bucketWallSampleTime(107, 15), 105);
  assert.equal(bucketWallSampleTime(120, 15), 120);
});

test("bucketWallSampleTime: snaps to 5s floor for oracle cadence", () => {
  assert.equal(bucketWallSampleTime(100, 5), 100);
  assert.equal(bucketWallSampleTime(103, 5), 100);
  assert.equal(bucketWallSampleTime(105, 5), 105);
  assert.equal(bucketWallSampleTime(107, 5), 105);
});

test("wallTrailSampleSecForTicker: universe scope is always 5s", () => {
  assert.equal(wallTrailSampleSecForTicker("PLTR", "universe"), UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("NVDA", "universe"), UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
});

test("wallTrailSampleSecForTicker: live scope — oracle 5s, on-demand 15s", () => {
  assert.equal(wallTrailSampleSecForTicker("SPX"), ORACLE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("SPY"), ORACLE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("QQQ"), ORACLE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("NVDA"), NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker("PLTR"), NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
  assert.equal(wallTrailSampleSecForTicker(null), NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC);
});

test("vectorWallTrailSecClient: oracle 5s, else 15s", () => {
  assert.equal(vectorWallTrailSecClient("SPY"), 5);
  assert.equal(vectorWallTrailSecClient("PLTR"), 15);
});

const CALL = [{ strike: 7575, pct: 4, gex: 3_000_000_000 }];
const PUT = [{ strike: 7500, pct: 7, gex: -2_000_000_000 }];

test("buildWallHistorySample: builds a GEX+VEX sample and rounds the float tail", () => {
  const s = buildWallHistorySample({
    time: 1000,
    gexWalls: { callWalls: [{ strike: 7575, pct: 4.0000001, gex: 3e9 }], putWalls: PUT },
    gammaFlip: 7511.360000000001,
    vexWalls: { callWalls: CALL, putWalls: [] },
    vexFlip: 7574.64,
  });
  assert.ok(s);
  assert.equal(s!.time, 1000);
  assert.equal(s!.walls.callWalls[0]!.strike, 7575);
  assert.ok(String(s!.gammaFlip).length <= 8, `flip not rounded: ${s!.gammaFlip}`);
  assert.ok(s!.vexWalls);
});

test("buildWallHistorySample: returns null when NEITHER lens has walls", () => {
  assert.equal(
    buildWallHistorySample({
      time: 1,
      gexWalls: { callWalls: [], putWalls: [] },
      gammaFlip: 7500,
      vexWalls: null,
      vexFlip: null,
    }),
    null
  );
});

test("buildWallHistorySample: honest gaps — GEX-only and VEX-only", () => {
  const gexOnly = buildWallHistorySample({
    time: 1,
    gexWalls: { callWalls: CALL, putWalls: PUT },
    gammaFlip: 7511,
    vexWalls: { callWalls: [], putWalls: [] },
    vexFlip: 9999,
  });
  assert.ok(gexOnly);
  assert.equal(gexOnly!.vexWalls, null);
  assert.equal(gexOnly!.vexFlip, null);
});
