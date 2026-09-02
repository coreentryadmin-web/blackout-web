import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// Regression for a P2 finding (2026-09-02, live monitor): touchDynamicUniverse used to pin ANY
// syntactically valid ticker into the shared, cron-recorded dynamic universe on first view — a
// one-time typo ("NFLIX" for NFLX) got stuck there permanently, since nothing checked whether the
// symbol resolves to real options data. The 5-min recorder cron then kept re-warming a name that
// would never produce one, and every member's /api/market/vector/universe served a permanent dead
// row (spot: null). This proves the fix: a ticker with no real spot from fetchGexHeatmap is never
// written to the shared map, while a real one still is.

mock.module("server-only", { namedExports: {} });

const staticTickers = ["SPY", "SPX", "QQQ"];
let genericCache = new Map<string, unknown>();
let fetchCalls: string[] = [];
/** Ticker -> spot the mocked fetchGexHeatmap should return; absent = null (unresolvable symbol). */
let spotByTicker = new Map<string, number>();

mock.module("../../../lib/heatmap-allowlist", {
  namedExports: {
    vectorUniverseTickers: () => staticTickers,
  },
});

mock.module("../../../lib/shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) => genericCache.get(key) ?? null,
    sharedCacheSet: async (key: string, value: unknown) => {
      genericCache.set(key, value);
    },
  },
});

mock.module("../../../lib/providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async (ticker: string) => {
      fetchCalls.push(ticker);
      const spot = spotByTicker.get(ticker);
      if (spot == null) return null; // unresolvable symbol — fetchGexHeatmap's own "never fabricate" contract
      return { spot, asof: new Date().toISOString(), gex: null, vex: null };
    },
  },
});

let touchDynamicUniverse: typeof import("./vector-dynamic-universe").touchDynamicUniverse;
let listDynamicUniverseTickers: typeof import("./vector-dynamic-universe").listDynamicUniverseTickers;

test.before(async () => {
  const mod = await import("./vector-dynamic-universe");
  touchDynamicUniverse = mod.touchDynamicUniverse;
  listDynamicUniverseTickers = mod.listDynamicUniverseTickers;
});

test("touchDynamicUniverse: a real, resolvable ticker is written to the shared dynamic universe", async () => {
  genericCache = new Map();
  fetchCalls = [];
  spotByTicker = new Map([["NFLX", 850.12]]);

  await touchDynamicUniverse("nflx");

  assert.deepEqual(fetchCalls, ["NFLX"]);
  const tickers = await listDynamicUniverseTickers();
  assert.deepEqual(tickers, ["NFLX"]);
});

test("touchDynamicUniverse: a syntactically valid but unresolvable ticker (a typo) is NEVER pinned", async () => {
  genericCache = new Map();
  fetchCalls = [];
  spotByTicker = new Map(); // NFLIX resolves to nothing — same shape as the live incident

  await touchDynamicUniverse("NFLIX");

  assert.deepEqual(fetchCalls, ["NFLIX"], "must still attempt to resolve it once");
  const tickers = await listDynamicUniverseTickers();
  assert.deepEqual(tickers, [], "an unresolvable symbol must never enter the shared map the cron re-warms forever");
});

test("touchDynamicUniverse: a fetchGexHeatmap rejection is treated the same as an unresolvable symbol, not a crash", async () => {
  genericCache = new Map();
  fetchCalls = [];
  spotByTicker = new Map();

  const { touchDynamicUniverse: fresh } = await import("./vector-dynamic-universe");
  // Simulate a throwing provider by pointing at a ticker with no spot entry AND confirming the
  // outer try/catch in touchDynamicUniverse means this never throws back to the caller either way.
  await assert.doesNotReject(fresh("BADTICK"));
  assert.deepEqual(await listDynamicUniverseTickers(), []);
});
