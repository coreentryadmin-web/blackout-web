import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for a live bug (found 2026-10-31, Ask Largo/5-engine standing mandate, live repro
// against a genuinely closed Saturday market -- the 5th instance of this exact cache key's
// staleness/non-monotonic-publish bug class; FINDINGS.md's own write-up on the 4th instance
// explicitly anticipated a 5th).
//
// evaluateSpxPlayStateCrossReplica() publishes the winning replica's eval result to the shared
// `spx-play-read:<date>` Redis key via a bare `sharedCacheSet(...)` call -- UNCONDITIONALLY, with
// no check on the result's content. Every OTHER reader/writer of this exact payload treats
// `assessed: false` as a one-off placeholder that must never be trusted/cached:
// `getSpxPlayState()`'s own `shouldCache: (value) => value.assessed !== false` (spx-service.ts,
// a few lines below this one) and `isSpxPlaySnapshotShareable()` (spx-play-freshness.ts) both
// exist specifically to stop a degenerate "nothing was assessed" eval (desk.source==="none" cold
// shell, or any other transient reason evaluateSpxPlayState() can legitimately resolve
// assessed:false) from being treated as a genuine, shareable "current play state."
//
// This explicit `sharedCacheSet` call is the ONE write path to this key that bypasses both
// protections: getSpxPlayState() passes `localOnly: true`, so withServerCache's own
// shouldCache-guarded Redis write never runs for this key -- making this call the sole publisher
// -- and it writes via a raw `sharedCacheSet`, not `writeRedisCache` (server-cache.ts), so it
// carries no `server-gen:<key>` generation stamp either. A transient assessed:false result
// therefore got published for every other replica's waitForPeerSpxPlaySnapshot/
// spxPlayReadFallback/peekSpxPlayState to pick up and replay, well past this route's own
// freshness budgets, with no ordering guard against a stale write clobbering a fresher one.
//
// Live-reproduced 2026-10-31 (Saturday, market closed, desk healthy/monotonic throughout):
// GET /api/market/spx/play alternated assessed:true/score:36 <-> assessed:false/score:0/
// direction:null across polls ~13s apart, with `as_of` jumping BACKWARD to an exact
// byte-identical older generation 22+ minutes after it was first observed, then forward again.
//
// Fix: gate the publish the same way every sibling path already does -- a degenerate
// (assessed:false) result must never become the shared "current" snapshot.

mock.module("server-only", { namedExports: {} });

let sharedCacheSetCalls: Array<{ key: string; value: unknown }> = [];

mock.module("../../../lib/shared-cache", {
  namedExports: {
    // The outer per-date eval lock -- wins, so evaluateSpxPlayState() actually runs.
    sharedCacheSetNx: async () => true,
    sharedCacheSet: async (key: string, value: unknown) => {
      sharedCacheSetCalls.push({ key, value });
      return undefined;
    },
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
    // Skip the off-hours peek shortcut entirely -- go straight to the real loadMergedSpxDesk()
    // fresh-load branch, the one under test here.
    isSpxEngineCronWindow: () => true,
    isPremarketPlanningWindow: () => false,
  },
});

// Simulates evaluateSpxPlayState() legitimately resolving a DEGENERATE (assessed:false) result --
// the exact shape evaluateSpxPlayCore's closed-market branch / scanningPayload produce whenever
// `desk.source === "none"` or confluence computation otherwise comes back null. The mechanism
// that PRODUCES assessed:false is not what this test is about (several already exist and are
// already guarded elsewhere); this test is about whether the result, however it arose, gets
// published to the shared cross-replica cache.
mock.module("./spx-evaluator", {
  namedExports: {
    readSpxPlaySnapshot: async () => ({
      available: false,
      phase: "SCANNING",
      action: "SCANNING",
      direction: null,
      grade: "D",
      score: 0,
      rawScore: 0,
      assessed: false,
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
      as_of: new Date().toISOString(),
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

test("BUG: evaluateSpxPlayStateCrossReplica must NOT publish a degenerate (assessed:false) eval result to the shared cross-replica cache -- only a genuinely assessed result may become the 'current' snapshot other replicas replay", async () => {
  sharedCacheSetCalls = [];

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");
  const result = await evaluateSpxPlayStateCrossReplica();

  assert.equal(
    (result as { assessed?: boolean }).assessed,
    false,
    "sanity check: the eval under test really did resolve to a degenerate result"
  );

  const publishedToSharedKey = sharedCacheSetCalls.filter((c) => c.key.includes("spx-play-read"));
  assert.equal(
    publishedToSharedKey.length,
    0,
    "a degenerate assessed:false result must never be published to the shared spx-play-read:<date> " +
      "key -- doing so lets another replica's peekSpxPlayState/waitForPeerSpxPlaySnapshot/" +
      "spxPlayReadFallback trust and replay it non-monotonically, well past this route's freshness " +
      "budget, exactly the live-reproduced flapping/backward-as_of bug this test guards against"
  );
});
