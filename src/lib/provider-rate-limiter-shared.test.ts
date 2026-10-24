import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDegradedLocalRps,
  acquireSlidingWindowRedisSlot,
  type RateLimiterRedisClient,
} from "./providers/provider-rate-limiter-shared";

test("computeDegradedLocalRps divides global budget across replicas", () => {
  assert.equal(computeDegradedLocalRps(2, 1), 2);
  assert.equal(computeDegradedLocalRps(2, 2), 1);
  assert.ok(Math.abs(3 * computeDegradedLocalRps(2, 3) - 2) < 1e-9);
});

/**
 * Minimal in-memory reimplementation of SLIDING_WINDOW_RATE_LIMIT_LUA's semantics (get curr/prev,
 * estimate, compare to the CALLER-SUPPLIED limit, INCR on admission). Faithful enough for these
 * tests because they run in well under a second, so every call lands on the same `curr` bucket key
 * and `prev` never exists — real Redis would behave identically in that case. There is no existing
 * fake/mock for this Lua path anywhere in the suite (checked); a full window-boundary simulation
 * would be more than this regression needs.
 */
function makeFakeSlidingWindowRedis(): RateLimiterRedisClient {
  const counts = new Map<string, number>();
  return {
    incr: async (key) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    expire: async () => 1,
    get: async (key) => {
      const v = counts.get(key);
      return v === undefined ? null : String(v);
    },
    eval: async (_script, _numkeys, currKey, prevKey, _elapsedFrac, limit) => {
      const curr = counts.get(String(currKey)) ?? 0;
      const prev = counts.get(String(prevKey)) ?? 0;
      // elapsedFrac is ignored (prev is always 0 in-window for these fast tests) — see doc comment.
      const estimated = curr + prev * 0;
      if (estimated >= Number(limit)) return 0;
      counts.set(String(currKey), curr + 1);
      return 1;
    },
    disconnect: () => {},
  };
}

// Regression for the 2026-09-09 live incident (queue waits blowing the 20s admission budget
// specifically at the RPS stage — "waited 20001ms of 20000ms" logged as global_rps): the
// concurrency-side reservation (reserveForLiveTraffic, uw-rate-limiter.ts) already stops a
// background sweep claiming the LAST concurrency slot, but nothing analogous protected the RPS
// sliding window — a background sweep and live traffic shared the exact same counter with the
// exact same ceiling, so a sweep hammering at GLOBAL_MAX_RPS could starve live traffic's RPS
// budget even while concurrency slots sat free. The fix passes a REDUCED ceiling (mirroring
// reserveForLiveTraffic's math) for background-tagged callers into this same shared-counter
// primitive; this proves that reduction actually protects a full-ceiling caller sharing the key.
test("acquireSlidingWindowRedisSlot: a reduced ceiling cannot claim the slot a full-ceiling caller still sees", async () => {
  const client = makeFakeSlidingWindowRedis();
  const prefix = "test:uw:rps";

  // Background-sweep-tagged caller, ceiling reserved down to 1 (mirrors reserveForLiveTraffic(2)).
  const sweepFirst = await acquireSlidingWindowRedisSlot(client, prefix, 1);
  assert.equal(sweepFirst, true, "first call in an empty window is admitted at either ceiling");

  // A second background-sweep call at the SAME reduced ceiling must now be rejected — one slot
  // has already been consumed by its own kind, and the reserved ceiling grants it no more.
  const sweepSecond = await acquireSlidingWindowRedisSlot(client, prefix, 1);
  assert.equal(sweepSecond, false, "a reduced-ceiling caller must not claim a second unit for itself");

  // Live traffic (full, unreserved ceiling 2) sharing the SAME counter must still get admitted —
  // this is the entire point of the reservation: the sweep can never claim the slot live traffic
  // needs, even though both sides are incrementing one shared Redis counter.
  const liveTraffic = await acquireSlidingWindowRedisSlot(client, prefix, 2);
  assert.equal(liveTraffic, true, "live traffic must still be admitted even after the sweep saturated its own reduced ceiling");
});

test("acquireSlidingWindowRedisSlot: without any reservation, a hammering caller can starve a peer sharing the ceiling", async () => {
  const client = makeFakeSlidingWindowRedis();
  const prefix = "test:uw:rps:unreserved";

  // Same ceiling for both sides (the pre-fix behavior) — a caller that got here first can consume
  // the entire shared budget, leaving nothing for the next caller even though it "deserves" a slot
  // just as much. This is the failure mode the reservation exists to prevent.
  const first = await acquireSlidingWindowRedisSlot(client, prefix, 2);
  const second = await acquireSlidingWindowRedisSlot(client, prefix, 2);
  const third = await acquireSlidingWindowRedisSlot(client, prefix, 2);
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(third, false, "the shared ceiling is exhausted once two callers have already been admitted");
});
