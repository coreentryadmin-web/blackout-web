import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  vectorFullStateCacheKey,
  readVectorFullStateCache,
  writeVectorFullStateCache,
} from "./vector-full-state-cache";
import { VECTOR_FULL_STATE_FIXTURE } from "./vector-full-state-fixture";

describe("vector-full-state cache", () => {
  test("cache key is vector:full-state:{version}:{ticker}:{horizon}, normalized", () => {
    assert.equal(vectorFullStateCacheKey("nvda", "all"), "vector:full-state:v2:NVDA:all");
    assert.equal(vectorFullStateCacheKey("SPY", "0dte"), "vector:full-state:v2:SPY:0dte");
  });

  // The version segment is the ONLY thing that makes a unit change safe to deploy: readers are
  // cache-first with a 15-min TTL, so without it the new code would serve old-shape snapshots for
  // 15 minutes (v1 held magnet.distancePct as a fraction, v2 holds it as a percent).
  test("the key carries an explicit payload-shape version", () => {
    assert.match(vectorFullStateCacheKey("SPX", "weekly"), /^vector:full-state:v\d+:SPX:weekly$/);
  });

  test("read returns null on a miss (never throws)", async () => {
    const miss = await readVectorFullStateCache("VFSNEVERWRITTEN", "weekly");
    assert.equal(miss, null);
  });

  test("write then read round-trips the full state (memory fallback when no Redis)", async () => {
    // A distinctive fake ticker so this never collides with a real cached snapshot.
    await writeVectorFullStateCache("VFSTESTX", "all", VECTOR_FULL_STATE_FIXTURE);
    const back = await readVectorFullStateCache("VFSTESTX", "all");
    // JSON round-trip through the shared cache preserves the whole object.
    assert.deepEqual(back, VECTOR_FULL_STATE_FIXTURE);
  });
});
