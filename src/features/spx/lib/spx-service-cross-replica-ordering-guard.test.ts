import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { todayEtYmd } from "../../../lib/providers/spx-session";

// Regression for the 6th instance of the `spx-play-read:<date>` cross-replica cache's staleness/
// non-monotonic-publish bug class -- live-reproduced 2026-10-31 AFTER PR #7061 (the 5th instance,
// a degenerate assessed:false publish) had already merged and its ECS deploy had fully completed.
// #7061's own "Fix rationale" section explicitly named this exact scenario as the deliberately
// deferred follow-up it chose not to fold in: "Considered also adding a generation-ordering guard
// ... If a future session finds a 6th instance of this pattern where two genuinely non-degenerate
// writes race out of order, that is the natural next, narrower follow-up -- not folded into this
// fix to keep it single-issue."
//
// evaluateSpxPlayStateCrossReplica()'s winning-the-lock branch publishes its eval result to the
// shared `spx-play-read:<date>` Redis key via a bare, unconditional `sharedCacheSet(...)` call.
// The ONLY gate on that publish is `assessed !== false` (added by #7061, excluding a degenerate
// placeholder) -- there is still no ordering/generation check at all, so a slower-but-older
// refresh (one whose own upstream desk read is older, but which happens to finish LATER -- e.g.
// racing the eval lock's own TTL edge) can clobber an already-published NEWER, equally genuine
// (assessed:true) result. Live evidence (3 independent runs, 2026-10-31 18:34-18:43 UTC,
// confirmed post-deploy): `GET /api/market/spx/play`'s `as_of` jumped BACKWARD by minutes between
// two consecutive assessed:true reads with genuinely different scores -- never the already-fixed
// assessed:false shape.
//
// Fix: route the publish through server-cache.ts's existing, already-tested cross-replica
// generation guard (`writeRedisCache` / `server-gen:<key>`, built 2026-10-15 for the sibling
// `spx-desk:<date>` key's identical failure shape) instead of a raw `sharedCacheSet`, stamped with
// the wall-clock time THIS eval started (not when it finished) -- a write whose own upstream read
// is older than one already recorded for this key is skipped instead of clobbering it.

mock.module("server-only", { namedExports: {} });

type StoredCall = { key: string; value: unknown };
let sharedCacheSetCalls: StoredCall[] = [];
let store: Map<string, unknown>;

mock.module("../../../lib/shared-cache", {
  namedExports: {
    // The outer per-date eval lock -- wins, so evaluateSpxPlayState() actually runs.
    sharedCacheSetNx: async () => true,
    sharedCacheSet: async (key: string, value: unknown) => {
      sharedCacheSetCalls.push({ key, value });
      store.set(key, value);
      return undefined;
    },
    sharedCacheGet: async (key: string) => (store.has(key) ? store.get(key) : null),
    sharedCacheDel: async () => undefined,
    sharedCacheGetWithTtl: async () => null,
  },
});

mock.module("./spx-desk-loader", {
  namedExports: {
    peekMergedSpxDesk: async () => null,
    loadMergedSpxDesk: async () => ({
      merged: { price: 7000, market_open: false, source: "polygon+uw-flow", as_of: new Date().toISOString() },
    }),
  },
});

mock.module("./spx-play-session-guards", {
  namedExports: {
    isSpxEngineCronWindow: () => true,
    isPremarketPlanningWindow: () => false,
  },
});

// A genuinely non-degenerate (assessed:true) eval result -- this is the exact shape #7061 did
// NOT gate, since it only excludes assessed:false.
function genuineResult(score: number, as_of: string) {
  return {
    available: true,
    phase: "SESSION",
    action: "HOLD",
    direction: "long",
    grade: "B",
    score,
    rawScore: score,
    assessed: true,
    headline: "Session closed",
    thesis: "closed",
    idle_message: null,
    factors: [],
    levels: { entry: null, stop: null, target: null, invalidation: "" },
    gates: { passed: true, blocks: [], warnings: [], entry_mode: "none", play_idea: null },
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
    as_of,
  };
}

// Mutable per-test return value -- `mock.module` for a given specifier is registered once for
// the whole file; re-registering it per-test (rather than mutating what the one registration
// returns) trips node:test's own mock-module bookkeeping across dynamic re-imports of the same
// module graph.
let nextSnapshot: ReturnType<typeof genuineResult> | null = null;

mock.module("./spx-evaluator", {
  namedExports: {
    readSpxPlaySnapshot: async () => nextSnapshot,
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

// evaluateSpxPlayStateCrossReplica() publishes via `void writeRedisCache(...).catch(...)` --
// fire-and-forget, same as the pre-fix `void sharedCacheSet(...)` it replaced, so the function
// itself returns before that detached promise chain (dynamic import + sharedCacheGet + two
// sharedCacheSet calls) necessarily settles. Give it a macrotask turn before asserting on `store`.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

test("BUG: evaluateSpxPlayStateCrossReplica must NOT let an older-generation publish clobber an already-published newer, equally genuine (assessed:true) result", async () => {
  sharedCacheSetCalls = [];
  store = new Map();
  process.env.REDIS_URL = "redis://fake:6379";

  const date = todayEtYmd();
  const valueKey = `server:spx-play-read:${date}`;
  const genKey = `server-gen:spx-play-read:${date}`;

  // Simulate: a sibling replica already published a NEWER result (its own refresh started at a
  // generatedAt far in the future relative to "now", standing in for "this call started earlier
  // but will finish later than that sibling's already-completed, newer-vintage write").
  const newerResult = genuineResult(36, "2026-10-31T18:40:38.033Z");
  store.set(genKey, Date.now() + 10_000_000);
  store.set(valueKey, newerResult);

  // THIS call's own eval resolves to a genuine (assessed:true) but OLDER-vintage result.
  nextSnapshot = genuineResult(29, "2026-10-31T18:34:16.244Z");

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");
  const returned = await evaluateSpxPlayStateCrossReplica();
  await flush();

  // Unchanged behavior for the single request that triggered this eval -- still gets its own
  // fresh result back, exactly like #7061 preserved for the degenerate case.
  assert.equal((returned as { score?: number }).score, 29, "the single triggering caller still gets its own fresh eval result");

  const stillStored = store.get(valueKey);
  assert.deepEqual(
    stillStored,
    newerResult,
    "an older-generation eval must never clobber the shared cache's already-published newer " +
      "result -- every other replica's waitForPeerSpxPlaySnapshot/spxPlayReadFallback/" +
      "peekSpxPlayState must keep seeing the newer snapshot, not regress to an older one"
  );
});

test("a genuinely newer eval DOES get published when no newer generation already exists", async () => {
  sharedCacheSetCalls = [];
  store = new Map();
  process.env.REDIS_URL = "redis://fake:6379";

  const date = todayEtYmd();
  const valueKey = `server:spx-play-read:${date}`;

  nextSnapshot = genuineResult(41, "2026-10-31T19:00:00.000Z");

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");
  await evaluateSpxPlayStateCrossReplica();
  await flush();

  const stored = store.get(valueKey) as { score?: number } | undefined;
  assert.equal(
    stored?.score,
    41,
    "a normal (non-racing) publish with no pre-existing newer generation must still reach the " +
      "shared cache -- the ordering guard must not block ordinary forward progress"
  );
});
