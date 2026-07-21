import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import type { VectorUniverseSnapshot } from "./vector-universe";

mock.module("server-only", { namedExports: {} });

const staticTickers = ["SPY", "SPX", "QQQ"];
let dynamicTickers: string[] = [];
let cacheStore: VectorUniverseSnapshot | null = null;
let fetchCalls: string[] = [];

mock.module("../../../lib/heatmap-allowlist", {
  namedExports: {
    vectorUniverseTickers: () => staticTickers,
  },
});

mock.module("./vector-dynamic-universe", {
  namedExports: {
    listDynamicUniverseTickers: async () => dynamicTickers,
    touchDynamicUniverse: async (raw: string) => {
      const t = String(raw).toUpperCase();
      if (!dynamicTickers.includes(t)) dynamicTickers.push(t);
    },
  },
});

mock.module("../../../lib/shared-cache", {
  namedExports: {
    sharedCacheGet: async () => cacheStore,
    sharedCacheSet: async (_key: string, value: VectorUniverseSnapshot) => {
      cacheStore = value;
    },
  },
});

mock.module("../../../lib/providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async (ticker: string) => {
      fetchCalls.push(ticker);
      return {
        spot: 100,
        asof: new Date().toISOString(),
        gex: {
          flip: 101,
          strike_totals: { "100": 1, "105": 2 },
        },
        vex: {
          flip: 99,
          strike_totals: { "95": 1, "100": 1 },
        },
      };
    },
  },
});

mock.module("./vector-wall-persist", {
  namedExports: {
    appendSessionWallSample: async () => {},
  },
});

mock.module("./vector-snapshot", {
  namedExports: {
    buildNarrowedHorizonWallSamples: async () => [],
  },
});

let buildVectorUniverseSnapshot: typeof import("./vector-universe").buildVectorUniverseSnapshot;
let ensureTickerInUniverseSnapshot: typeof import("./vector-universe").ensureTickerInUniverseSnapshot;
let loadVectorUniverseSnapshot: typeof import("./vector-universe").loadVectorUniverseSnapshot;

before(async () => {
  const mod = await import("./vector-universe");
  buildVectorUniverseSnapshot = mod.buildVectorUniverseSnapshot;
  ensureTickerInUniverseSnapshot = mod.ensureTickerInUniverseSnapshot;
  loadVectorUniverseSnapshot = mod.loadVectorUniverseSnapshot;
});

test("buildVectorUniverseSnapshot: plain build unions dynamic tickers", async () => {
  dynamicTickers = ["HOOD", "PLTR"];
  fetchCalls = [];
  cacheStore = null;

  const snap = await buildVectorUniverseSnapshot();
  assert.deepEqual(
    snap.rows.map((r) => r.ticker).sort(),
    ["HOOD", "PLTR", "QQQ", "SPX", "SPY"]
  );
  assert.ok(fetchCalls.includes("HOOD"));
  assert.ok(fetchCalls.includes("PLTR"));
});

test("ensureTickerInUniverseSnapshot: appends missing ticker to warmed snapshot", async () => {
  dynamicTickers = [];
  fetchCalls = [];
  cacheStore = {
    updatedAt: Date.now(),
    rows: [
      {
        ticker: "SPY",
        spot: 500,
        gammaFlip: 501,
        vexFlip: 499,
        topCallWall: 510,
        topPutWall: 490,
        topCallPct: 10,
        topPutPct: 8,
        asOf: Date.now(),
      },
    ],
  };

  await ensureTickerInUniverseSnapshot("HOOD");
  const snap = await loadVectorUniverseSnapshot();
  assert.ok(snap);
  assert.deepEqual(snap!.rows.map((r) => r.ticker).sort(), ["HOOD", "SPY"]);
  assert.equal(snap!.rows.find((r) => r.ticker === "HOOD")?.spot, 100);
});

test("ensureTickerInUniverseSnapshot: no-op when ticker already present", async () => {
  fetchCalls = [];
  cacheStore = {
    updatedAt: Date.now(),
    rows: [
      {
        ticker: "HOOD",
        spot: 42,
        gammaFlip: null,
        vexFlip: null,
        topCallWall: null,
        topPutWall: null,
        topCallPct: null,
        topPutPct: null,
        asOf: Date.now(),
      },
    ],
  };

  await ensureTickerInUniverseSnapshot("HOOD");
  assert.deepEqual(fetchCalls, []);
  assert.equal(cacheStore.rows.find((r) => r.ticker === "HOOD")?.spot, 42);
});
