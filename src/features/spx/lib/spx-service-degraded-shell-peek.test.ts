import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for a live bug (found 2026-10-31, Ask Largo/5-engine standing mandate, live repro
// against a genuinely closed Saturday market). evaluateSpxPlayState()'s off-hours fast path
// (spx-service.ts) peeks `spx-merged:<date>` with a deliberate 24h staleness tolerance
// (peekMergedSpxDesk({ maxStaleMs: 24h })) and, whenever that peek returns ANYTHING non-null with
// market_open:false, trusts it unconditionally and builds the member-facing closed-market
// snapshot straight from it via closedMarketPlaySnapshot().
//
// That peeked bundle can legitimately be a DEGRADED BOOTSTRAP SHELL (spx-desk.ts's
// deskShellFromPulse/emptyDeskPayload, source:"none") rather than a real merged-desk build:
// loadMergedSpxDeskCore() (spx-desk-loader.ts) composes its `desk` component from loadSpxDesk(),
// which itself falls back to deskShellFromPulse() whenever buildSpxDesk() blows
// deskBootstrapMaxBlockMs(). That fallback return is NOT an error -- loadMergedSpxDeskCore()
// resolves "successfully" with the degraded shell folded in, so withServerCache's refreshCache()
// WRITES this source:"none" bundle into spx-merged:<date> (local store + Redis) as if it were a
// normal fresh value. Once written, peekMergedSpxDesk()'s 24h tolerance means ANY replica that
// cached this exact bundle keeps re-serving it from its own local store (peekServerCache's
// local-fallback branch, server-cache.ts) long after Redis's own short TTL (deskCacheTtlMs(),
// 10s default) has expired on it -- peekServerCache never invokes a loader or triggers any SWR
// background refresh, so nothing on that path ever replaces it. The only thing that calls the
// real loadMergedSpxDesk() off-hours is maybeRefreshMergedSpxDeskOffHours(), which is throttled by
// a FLEET-WIDE NX lock (one replica, once per spxMergedDeskOffHoursRefreshIntervalSec() == 5 min
// default) -- and even when it does fire on the SAME poisoned replica, it just re-reads the exact
// same still-within-TTL local/Redis entry it already wrote, doing nothing.
//
// spx-play-engine.ts's own closed-market branch already KNOWS this shape is untrustworthy -- it
// gates `closedConfluence` on `desk.source !== "none"` specifically because "a cold-cache
// bootstrap shell ... has a real price and available:true but no GEX/flow layer ever merged in".
// But evaluateSpxPlayState()'s off-hours fast path never applies that same check BEFORE deciding
// to trust the peek -- so it hands exactly the shape spx-play-engine.ts itself distrusts straight
// into closedMarketPlaySnapshot(), producing a fully degenerate assessed:false/score:0/
// factors:[]/direction:null response with a frozen as_of, while a sibling cache lane
// (spx-desk:<date>, read directly by /api/market/spx/desk) can be fully healthy at the identical
// instant. Live-reproduced 2026-10-31: two independent poll runs 5m35s apart returned the
// BYTE-IDENTICAL degenerate play response (same frozen as_of) while /api/market/spx/desk and
// /api/market/spx/bootstrap showed a healthy, current desk (source:"polygon+uw-flow") throughout.
//
// Fix: the off-hours fast path must apply the SAME "is this a real build" check spx-play-engine.ts
// already uses (`source !== "none"`) before trusting the peeked bundle -- when the peek is a
// degraded shell, fall through to the real, maxBlockMs-bounded loadMergedSpxDesk() call exactly
// as already happens when the peek is null, the market is open, or it's premarket.

// spx-service.ts's own import graph pulls in "server-only"-guarded provider modules -- same reason
// the sibling spx-service-*.test.ts files in this directory stub this out.
mock.module("server-only", { namedExports: {} });

const STALE_AS_OF = new Date(Date.now() - 20 * 60 * 1000).toISOString();

/** A degraded bootstrap shell -- real price, available:true, but source:"none" (see spx-desk.ts's
 *  deskShellFromPulse/mergePulseIntoDesk's own `available: pulse.available || base.available` fix
 *  and emptyDeskPayload's `source: "none"`). This is exactly what a poisoned spx-merged:<date>
 *  cache entry looks like. */
function degradedShellBundle() {
  return {
    desk: { price: 6500, market_open: false, source: "none", as_of: STALE_AS_OF },
    flow: null,
    pulse: null,
    merged: {
      price: 6500,
      market_open: false,
      source: "none",
      as_of: STALE_AS_OF,
      polled_at: STALE_AS_OF,
    },
  };
}

/** A genuine, healthy merged-desk build -- what loadMergedSpxDesk() should return when it
 *  actually runs (bounded by maxBlockMs) instead of reusing the degenerate peek. */
function healthyMergedBundle() {
  const freshAsOf = new Date().toISOString();
  return {
    desk: { price: 7580.07, market_open: false, source: "polygon+uw-flow", as_of: freshAsOf },
    flow: null,
    pulse: null,
    merged: {
      price: 7580.07,
      market_open: false,
      source: "polygon+uw-flow",
      as_of: freshAsOf,
      polled_at: freshAsOf,
    },
  };
}

let loadMergedCalls = 0;

mock.module("../../../lib/shared-cache", {
  namedExports: {
    // Every sharedCacheSetNx call "wins" -- the outer per-date eval lock (so
    // evaluateSpxPlayState() actually runs) AND the off-hours bg-refresh throttle (irrelevant to
    // this test either way, since the fix removes that call entirely on the degraded-shell path).
    sharedCacheSetNx: async () => true,
    sharedCacheSet: async () => undefined,
    sharedCacheDel: async () => undefined,
    sharedCacheGetWithTtl: async () => null,
  },
});

mock.module("./spx-desk-loader", {
  namedExports: {
    // The off-hours shortcut peeks a POISONED degraded shell -- this is the live failure mode.
    peekMergedSpxDesk: async () => degradedShellBundle(),
    // The real, bounded loader returns a HEALTHY bundle -- distinguishable by `source` so the
    // test can prove WHICH bundle actually fed the response.
    loadMergedSpxDesk: async () => {
      loadMergedCalls++;
      return healthyMergedBundle();
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

// Bypasses the real play-engine (spx-play-engine.ts) -- irrelevant to the peek-trust logic under
// test. Smuggles `merged.source` through into the response's `direction` field so the test can
// observe which bundle (the poisoned peek vs the healthy fresh load) actually fed the snapshot.
mock.module("./spx-evaluator", {
  namedExports: {
    readSpxPlaySnapshot: async (merged: { as_of?: string; polled_at?: string; source?: string }) => ({
      available: false,
      phase: "SCANNING",
      action: "SCANNING",
      direction: merged.source,
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

test("off-hours fast path must not trust a peeked merged-desk snapshot whose source is the degraded bootstrap-shell marker 'none' -- it must fall through to a real loadMergedSpxDesk() call instead", async () => {
  loadMergedCalls = 0;

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");
  const result = await evaluateSpxPlayStateCrossReplica();

  assert.equal(
    loadMergedCalls,
    1,
    "a degraded (source:'none') peek must not be trusted as-is -- the real, bounded " +
      "loadMergedSpxDesk() must be called exactly once to get an honest read"
  );
  assert.equal(
    (result as { direction: string | null }).direction,
    "polygon+uw-flow",
    "the served snapshot must be built from the HEALTHY fresh load (source:'polygon+uw-flow'), " +
      "not from the poisoned degraded-shell peek (source:'none') -- serving the shell produces a " +
      "fully degenerate assessed:false/score:0/factors:[]/direction:null response even while the " +
      "real desk is healthy via sibling cache lanes at the identical instant"
  );
});
