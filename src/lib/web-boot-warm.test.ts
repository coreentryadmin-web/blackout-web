import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// REGRESSION (2026-10-08): ensureWebBootWarm() used to call getZeroDteBoardPayload()
// unconditionally on EVERY ECS web task cold start, with no time-of-day gate. 0DTE
// discovery crons are market-hours-only, so outside the extended warm window the shared
// Redis board snapshot is always >10min stale (BOARD_STALE_SERVE_MAX_AGE_MS) — every boot
// therefore fell through to a full cold board rebuild (buildAndPublishBoard ->
// scanZeroDteBoard), a multi-engine FLOW/BREAKOUT/PIN discovery pass that fans
// fetchGexHeatmap out across dozens of tickers, several escalating to a full unfiltered
// chain pull. Measured live via CloudWatch Logs Insights: bursts of 20-100+
// "[polygon-gex] full-chain escalation ADOPTED" lines within 15s, repeating roughly every
// 15-20 minutes through a 03:30-06:30 UTC overnight window with zero RTH relevance, each
// burst's log stream matching an ECS task that `describe_services` showed being freshly
// started/stopped within minutes (a near-continuous rolling replacement driven by a cascade
// of small merges, each triggering its own ECS deploy) — i.e. every fresh web task
// independently paid this cost right as it was registered as a live ALB target. This
// time-correlated 1:1 with the ALB TargetResponseTime Max spikes (22-55s) that flagged the
// investigation.
//
// This test proves the fix: outside the extended warm window, getZeroDteBoardPayload() is
// never called from boot-warm, while the OTHER (cheap, cache-reader) boot-warm tasks still
// run — the fix removes only the expensive, throwaway-off-hours piece, not the warm pass.
//
// mock.module() resolves bare specifiers relative to this file, not through the "@/"
// tsconfig alias (see src/app/api/platform/intel/route.test.ts) — this file lives in the
// same directory as web-boot-warm.ts, so the relative paths below are identical to what
// web-boot-warm.ts's own "@/..." imports resolve to.

let zeroDteBoardCalls = 0;
let bootstrapBundleCalls = 0;
let mergedSpxDeskCalls = 0;
let seedGexCalls: string[] = [];
let warmVectorStreamHubCalls = 0;

mock.module("./et-market-hours", {
  namedExports: {
    isEtExtendedWarmHours: () => false,
    isEtCashRth: () => false,
    tickerShard: () => 0,
  },
});

mock.module("./platform/zerodte-service", {
  namedExports: {
    getZeroDteBoardPayload: async () => {
      zeroDteBoardCalls += 1;
      return {};
    },
  },
});

mock.module("./providers/polygon-options-gex", {
  namedExports: {
    seedGexHeatmapFromRedis: async (ticker: string) => {
      seedGexCalls.push(ticker);
    },
  },
});

mock.module("../features/thermal/lib/thermal-compare-presets", {
  namedExports: {
    comparePresetWarmTickers: () => ["SPY", "QQQ"],
  },
});

mock.module("../features/spx/lib/spx-desk-loader", {
  namedExports: {
    loadBootstrapBundle: async () => {
      bootstrapBundleCalls += 1;
      return {};
    },
    loadMergedSpxDesk: async () => {
      mergedSpxDeskCalls += 1;
      return {};
    },
  },
});

mock.module("../features/vector/lib/vector-stream-hub", {
  namedExports: {
    warmVectorStreamHub: async () => {
      warmVectorStreamHubCalls += 1;
    },
  },
});

mock.module("../features/vector/lib/vector-ticker", {
  namedExports: {
    VECTOR_DEFAULT_TICKER: "SPY",
  },
});

mock.module("./process-role", {
  namedExports: {
    isWebProcess: () => true,
    shouldRunRthWarmLeader: () => false,
    shouldRunVectorBeadRecorder: () => false,
  },
});

let awaitWebBootWarm: (maxMs?: number) => Promise<void>;

before(async () => {
  ({ awaitWebBootWarm } = await import("./web-boot-warm"));
});

describe("ensureWebBootWarm — off-hours gate on the 0DTE board warm", () => {
  test("skips getZeroDteBoardPayload() outside the extended warm window, but still runs the other cheap boot-warm tasks", async () => {
    await awaitWebBootWarm(2_000);

    assert.equal(
      zeroDteBoardCalls,
      0,
      "getZeroDteBoardPayload() must NOT run from boot-warm outside isEtExtendedWarmHours() — " +
        "it falls through to a full multi-engine discovery scan when the shared board snapshot " +
        "is stale, which it always is off-hours"
    );

    // The fix must not disable boot-warm entirely — only the expensive, throwaway-off-hours
    // 0DTE board piece. Every other (cheap, cache-reader) task still runs.
    assert.equal(bootstrapBundleCalls, 1);
    assert.equal(mergedSpxDeskCalls, 1);
    assert.equal(warmVectorStreamHubCalls, 1);
    assert.deepEqual(seedGexCalls.sort(), ["QQQ", "SPY"]);
  });
});
