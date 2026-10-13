import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Sibling of web-boot-warm.test.ts's off-hours case — a separate FILE (not a second `test()`
// in the same file) on purpose: ensureWebBootWarm() is a once-per-process singleton guarded by
// a globalThis flag + a module-private `bootWarmInflight` promise, so the two branches of the
// new isEtExtendedWarmHours() gate can only be exercised in isolation across separate module
// graphs — node:test's default per-file process isolation gives exactly that, a single
// `test()` per file does not need it, but splitting the two scenarios across files does.
//
// This file proves the OTHER half of the fix: boot-warm still warms the 0DTE board during the
// extended window (4am-8pm ET) exactly as before — the gate added in web-boot-warm.ts only
// removes the off-hours call, it does not regress the on-hours pre-warm.

let zeroDteBoardCalls = 0;

mock.module("./et-market-hours", {
  namedExports: {
    isEtExtendedWarmHours: () => true,
    isEtCashRth: () => true,
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
    seedGexHeatmapFromRedis: async () => {},
  },
});

mock.module("../features/thermal/lib/thermal-compare-presets", {
  namedExports: {
    comparePresetWarmTickers: () => ["SPY"],
  },
});

mock.module("../features/spx/lib/spx-desk-loader", {
  namedExports: {
    loadBootstrapBundle: async () => ({}),
    loadMergedSpxDesk: async () => ({}),
  },
});

mock.module("../features/vector/lib/vector-stream-hub", {
  namedExports: {
    warmVectorStreamHub: async () => {},
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

describe("ensureWebBootWarm — still warms the 0DTE board inside the extended window", () => {
  test("calls getZeroDteBoardPayload() when isEtExtendedWarmHours() is true", async () => {
    await awaitWebBootWarm(2_000);

    assert.equal(
      zeroDteBoardCalls,
      1,
      "the 0DTE board pre-warm must still run during the extended warm window — the off-hours " +
        "gate must not silently disable it around the clock"
    );
  });
});
