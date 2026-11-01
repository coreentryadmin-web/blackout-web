import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// REGRESSION (round 330): play-engine-heartbeat.ts's `ensureInitialized()` used to set its
// `initialized` flag to `true` BEFORE the DB hydration read (`getMeta`) resolved — "mark
// eagerly so concurrent callers don't double-read". That made the flag an unsafe gate: a
// SECOND concurrent recordPlayEngineTick() call, starting while the FIRST call's `getMeta`
// is still in flight, sees `initialized === true` synchronously and returns at once — well
// before hydration has actually applied the persisted tick_count. The second call then
// increments `tickCount` from its stale PRE-hydration value, and once the first call's
// hydration finally resolves, it overwrites `tickCount` with the (older) persisted value —
// silently discarding the second call's tick.
//
// Fix: share one in-flight hydration promise (the same single-flight pattern already used by
// flow-events.ts's `ensureRedisBridge`/`bridgeInit` and shared-cache.ts's `getRedis`) so every
// concurrent caller actually AWAITS hydration before touching tickCount.
//
// Same mocking approach as server-cache-redis-generation.test.ts / admin-zerodte-health.test.ts:
// mock.module() must be registered before play-engine-heartbeat.ts (and therefore its "./db"
// import) is ever loaded, so the module under test is imported dynamically inside before().
// Run with: node --import tsx --experimental-test-module-mocks --test \
//   src/lib/play-engine-heartbeat-init-race.test.ts

/** Resolves on the next macrotask (setTimeout(0)) — simulates a real DB round trip taking
 *  longer than a plain microtask, the same way thermal-discord-breach-lock-concurrency.test.ts's
 *  fake loader models a real Redis round trip. */
function nextMacrotask<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

// The persisted heartbeat row this process is "restarting" from — a real prior session's
// tick_count that must survive the race intact.
const PERSISTED_TICK_COUNT = 50;
let persistedPayload: string | null = JSON.stringify({
  last_tick_at: new Date(Date.now() - 60_000).toISOString(),
  last_source: "cron",
  tick_count: PERSISTED_TICK_COUNT,
});

let getMetaCalls = 0;

mock.module("./db", {
  namedExports: {
    dbConfigured: () => true,
    // Every call takes a real "DB round trip" tick, so two near-simultaneous callers can
    // both observe the pre-hydration state before either's read resolves.
    getMeta: async (_key: string) => {
      getMetaCalls += 1;
      return nextMacrotask(persistedPayload);
    },
    setMeta: async (_key: string, value: string) => {
      persistedPayload = value;
    },
  },
});

let recordPlayEngineTick: typeof import("./play-engine-heartbeat").recordPlayEngineTick;
let getPlayEngineHeartbeat: typeof import("./play-engine-heartbeat").getPlayEngineHeartbeat;

before(async () => {
  ({ recordPlayEngineTick, getPlayEngineHeartbeat } = await import("./play-engine-heartbeat"));
});

test("two concurrent recordPlayEngineTick() calls racing cold-start hydration both count", async () => {
  // Two ticks fire essentially simultaneously, before either's ensureInitialized() hydration
  // read has resolved — the exact cold-start race the bug reproduces.
  await Promise.all([recordPlayEngineTick("cron"), recordPlayEngineTick("evaluate")]);

  const after = getPlayEngineHeartbeat();

  // The real persisted count (50) plus BOTH of these ticks must be reflected — neither tick
  // may be silently discarded by a hydration read that lands after the other tick already
  // incremented from a stale pre-hydration value.
  assert.equal(
    after.tick_count,
    PERSISTED_TICK_COUNT + 2,
    `expected both concurrent ticks to be counted on top of the persisted ${PERSISTED_TICK_COUNT} ` +
      `(got ${after.tick_count}) — a tick was silently dropped by the init race`
  );

  // Hydration itself must still only read the DB once (single-flight), not once per caller.
  assert.equal(getMetaCalls, 1, "hydration must be single-flighted across concurrent callers");
});
