import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import type { VectorUniverseSnapshot } from "./vector-universe";

mock.module("server-only", { namedExports: {} });

const staticTickers = ["SPY", "SPX", "QQQ"];
let dynamicTickers: string[] = [];
let cacheStore: VectorUniverseSnapshot | null = null;
let genericCache = new Map<string, unknown>();
let fetchCalls: string[] = [];
let wallSampleCalls: string[] = [];

mock.module("../../../lib/heatmap-allowlist", {
  namedExports: {
    vectorUniverseTickers: () => staticTickers,
  },
});

mock.module("./vector-dynamic-universe", {
  namedExports: {
    listDynamicUniverseTickers: async () => dynamicTickers,
    listSharedUniverseTickers: async () => [
      ...new Set([...staticTickers, ...dynamicTickers].map((t) => t.toUpperCase())),
    ],
    mergeSharedUniverseTickers: (staticList: string[], dynamicList: string[]) => [
      ...new Set([...staticList, ...dynamicList].map((t) => String(t).trim().toUpperCase()).filter(Boolean)),
    ],
    touchDynamicUniverse: async (raw: string) => {
      const t = String(raw).toUpperCase();
      if (!dynamicTickers.includes(t)) dynamicTickers.push(t);
    },
  },
});

mock.module("../../../lib/shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) => {
      if (key === "vector:universe:snapshot") return cacheStore;
      return genericCache.get(key) ?? null;
    },
    sharedCacheSet: async (key: string, value: unknown) => {
      if (key === "vector:universe:snapshot") {
        cacheStore = value as VectorUniverseSnapshot;
        return;
      }
      genericCache.set(key, value);
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
    appendSessionWallSample: async (sessionYmd: string, _sample: unknown, ticker: string) => {
      wallSampleCalls.push(`${sessionYmd}:${ticker}`);
      return true;
    },
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
let warmDynamicTickerSessionWall: typeof import("./vector-universe").warmDynamicTickerSessionWall;

before(async () => {
  const mod = await import("./vector-universe");
  buildVectorUniverseSnapshot = mod.buildVectorUniverseSnapshot;
  ensureTickerInUniverseSnapshot = mod.ensureTickerInUniverseSnapshot;
  loadVectorUniverseSnapshot = mod.loadVectorUniverseSnapshot;
  warmDynamicTickerSessionWall = mod.warmDynamicTickerSessionWall;
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

test("warmDynamicTickerSessionWall: records session bead for dynamic ticker once", async () => {
  fetchCalls = [];
  wallSampleCalls = [];
  genericCache = new Map();

  await warmDynamicTickerSessionWall("HOOD");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0], "HOOD");
  assert.equal(wallSampleCalls.length, 1);
  assert.match(wallSampleCalls[0]!, /:HOOD$/);

  fetchCalls = [];
  wallSampleCalls = [];
  await warmDynamicTickerSessionWall("HOOD");
  assert.deepEqual(fetchCalls, []);
  assert.deepEqual(wallSampleCalls, []);
});

test("warmDynamicTickerSessionWall: skips static allowlist tickers", async () => {
  fetchCalls = [];
  wallSampleCalls = [];
  genericCache = new Map();

  await warmDynamicTickerSessionWall("SPY");
  assert.deepEqual(fetchCalls, []);
  assert.deepEqual(wallSampleCalls, []);
});
