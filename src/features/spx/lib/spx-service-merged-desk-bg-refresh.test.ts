import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for a live bug (found 2026-10-26, Ask Largo/5-engine standing mandate, live repro
// pre-7am ET). The off-hours closed-market shortcut in evaluateSpxPlayState() (spx-service.ts)
// only ever PEEKS `spx-merged:<date>` (Redis/L1 only, 24h staleness tolerance) and never calls
// the real loadMergedSpxDesk(). Outside isSpxEngineCronWindow(), nothing else in the app refreshes
// that cache either, so once its own short TTL lapses in Redis it can go cold for the ENTIRE
// off-hours window, and each ECS replica falls back to its own independently-aged per-process
// local copy (peekServerCache, server-cache.ts).
//
// Live-reproduced 2026-10-26: GET /api/market/spx/play polled 20s apart returned `as_of` jumping
// BACKWARD (2026-10-26T10:36:47Z -> 10:19:08Z) with two DIFFERENT computed scores (4, then 6) for
// what should be one "current" read -- different replicas serving different frozen desk vintages,
// non-monotonically, to the same member.
//
// Fix: maybeRefreshMergedSpxDeskOffHours() fires a throttled (sharedCacheSetNx), non-blocking
// loadMergedSpxDesk() refresh from the off-hours shortcut so `spx-merged:<date>` never goes fully
// cold, bounding cross-replica divergence to spxMergedDeskOffHoursRefreshIntervalSec() instead of
// growing unboundedly across the whole night. This suite exercises that wiring live through
// evaluateSpxPlayStateCrossReplica (the real exported entry point), not just via source text.

// spx-service.ts's own import graph pulls in "server-only"-guarded provider modules -- same reason
// the sibling spx-service-*.test.ts files in this directory stub this out.
mock.module("server-only", { namedExports: {} });

let setNxCalls: string[] = [];
let throttleWon = true;

mock.module("../../../lib/shared-cache", {
  namedExports: {
    sharedCacheSetNx: async (key: string) => {
      setNxCalls.push(key);
      if (key.startsWith("spx-merged-desk-bg-refresh")) return throttleWon;
      return true; // the outer per-date eval lock: always "won" so evaluateSpxPlayState() runs
    },
    sharedCacheSet: async () => undefined,
    sharedCacheDel: async () => undefined,
    sharedCacheGetWithTtl: async () => null,
  },
});

let loadMergedCalls = 0;
let peekCalls = 0;

function closedBundle() {
  const staleAsOf = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // ~20 min stale
  return {
    desk: { price: 6500, market_open: false, source: "none", as_of: staleAsOf },
    flow: null,
    pulse: null,
    merged: {
      price: 6500,
      market_open: false,
      source: "none",
      as_of: staleAsOf,
      polled_at: staleAsOf,
    },
  };
}

// Bypasses the heavy real desk-build chain (Polygon/UW network calls) -- this suite is testing
// the off-hours REFRESH-THROTTLE wiring in spx-service.ts, not the desk builder itself.
mock.module("./spx-desk-loader", {
  namedExports: {
    peekMergedSpxDesk: async () => {
      peekCalls++;
      return closedBundle();
    },
    loadMergedSpxDesk: async () => {
      loadMergedCalls++;
      return closedBundle();
    },
  },
});

mock.module("./spx-play-session-guards", {
  namedExports: {
    // Forces the off-hours (!cron window) + not-premarket branch every time, regardless of
    // when this suite actually runs.
    isSpxEngineCronWindow: () => false,
    isPremarketPlanningWindow: () => false,
  },
});

// Bypasses the real play-engine (spx-play-engine.ts) -- irrelevant to the refresh-throttle logic
// under test, and pulls in a DB-backed chain this suite would otherwise need to mock out too.
mock.module("./spx-evaluator", {
  namedExports: {
    readSpxPlaySnapshot: async (merged: { as_of?: string; polled_at?: string }) => ({
      available: false,
      phase: "SCANNING",
      action: "SCANNING",
      direction: null,
      grade: "D",
      score: 0,
      rawScore: 0,
      headline: "Session closed",
      thesis: "closed",
      idle_message: null,
      factors: [],
      levels: { entry: null, stop: null, target: null, invalidation: "" },
      gates: {
        passed: false,
        blocks: ["Session closed"],
        warnings: [],
        entry_mode: "none",
        play_idea: null,
      },
      claude: null,
      cortex: null,
      open_play: null,
      confirmations: null,
      technicals: null,
      mtf: null,
      option_ticket: null,
      watch: null,
      telemetry: null,
      lotto_play: null,
      power_play: null,
      session_phase: "closed",
      signal_committed: false,
      as_of: merged.polled_at ?? merged.as_of ?? new Date().toISOString(),
    }),
  },
});

mock.module("./spx-play-store", {
  namedExports: {
    loadOpenPlay: async () => null,
  },
});

mock.module("./spx-voice-feed-store", {
  namedExports: {
    observeSpxPlayVoiceTransitions: async () => undefined,
  },
});

/** Flush pending microtasks/macrotasks so the `void`-fired background refresh gets a chance to run. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("off-hours closed-market shortcut fires a throttled background loadMergedSpxDesk() refresh when the throttle lock is won", async () => {
  setNxCalls = [];
  throttleWon = true;
  loadMergedCalls = 0;
  peekCalls = 0;

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");
  const result = await evaluateSpxPlayStateCrossReplica();
  await flush();

  assert.ok(peekCalls >= 1, "must have taken the off-hours peek shortcut");
  assert.ok(
    setNxCalls.some((k) => k.startsWith("spx-merged-desk-bg-refresh")),
    "must attempt the throttle lock for the background merged-desk refresh"
  );
  assert.equal(
    loadMergedCalls,
    1,
    "must fire exactly one background loadMergedSpxDesk() refresh when the throttle lock is won"
  );
  assert.equal(
    (result as { session_phase: string }).session_phase,
    "closed",
    "sanity: still served the closed-market snapshot on the fast path"
  );
});

test("off-hours closed-market shortcut skips the background refresh when the throttle lock is already held (another replica/recent poll within the window)", async () => {
  setNxCalls = [];
  throttleWon = false;
  loadMergedCalls = 0;
  peekCalls = 0;

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");
  await evaluateSpxPlayStateCrossReplica();
  await flush();

  assert.ok(
    setNxCalls.some((k) => k.startsWith("spx-merged-desk-bg-refresh")),
    "must still attempt the throttle lock"
  );
  assert.equal(
    loadMergedCalls,
    0,
    "must NOT fire a redundant background refresh when the throttle lock is already held -- this is " +
      "what keeps the fix from restoring trading-hours refresh cadence off-hours"
  );
});
