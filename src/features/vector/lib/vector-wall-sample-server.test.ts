import { test } from "node:test";
import assert from "node:assert/strict";
import { wallTrailSampleSecForTicker } from "./vector-wall-sample-server";
import {
  NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
  ORACLE_WALL_TRAIL_SAMPLE_SEC,
  UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
} from "./vector-wall-sample";

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
