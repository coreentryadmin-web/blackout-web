import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import type { VectorUniverseSnapshot } from "./vector-universe";
import { todayEtYmd } from "@/lib/providers/spx-session";

mock.module("server-only", { namedExports: {} });

const staticTickers = ["SPY", "SPX", "QQQ"];
let dynamicTickers: string[] = [];
let cacheStore: VectorUniverseSnapshot | null = null;
let genericCache = new Map<string, unknown>();
let fetchCalls: string[] = [];
let fetchInFlight = 0;
let maxFetchInFlight = 0;
let wallSampleCalls: string[] = [];
let wallSampleWrites: Array<{
  ticker: string;
  horizon?: string;
  sample: { walls?: { callWalls?: { strike: number }[]; putWalls?: { strike: number }[] } };
}> = [];

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
    removeDynamicUniverseTicker: async () => {},
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
      // Concurrency-bound regression fixture (2026-09-04 audit finding, unbounded fan-out): a
      // "CONC*" ticker holds briefly so a concurrency-tracking test can observe how many calls
      // are in flight together, without slowing down every other test in this file.
      if (ticker.startsWith("CONC")) {
        fetchInFlight += 1;
        maxFetchInFlight = Math.max(maxFetchInFlight, fetchInFlight);
        await new Promise((r) => setTimeout(r, 5));
        fetchInFlight -= 1;
        return {
          spot: 100,
          asof: new Date().toISOString(),
          gex: { flip: 101, strike_totals: { "100": 1, "105": 2 } },
          vex: { flip: 99, strike_totals: { "95": 1, "100": 1 } },
        };
      }
      // Regression fixture for the 2026-09-04 audit finding: strike 90 (below spot) carries more
      // |gamma| than strike 108 (above spot), so the unconstrained scan used to pick 90 as the
      // "call wall" — a resistance level below current price — the exact live IBIT/SPX shape.
      if (ticker === "INVERT") {
        // "wrong side of spot" shape reproduced through the narrowed-horizon path
        // (`strikeTotalsForHorizonFromCells`, which sums `cells` rather than reading the
        // already-summed `strike_totals` the main gexWalls computation uses).
        const todayYmd = todayEtYmd();
        return {
          spot: 100,
          asof: new Date().toISOString(),
          expiries: [todayYmd],
          gex: {
            flip: 101,
            strike_totals: { "90": 5e9, "108": 1e9, "92": -1e9 },
            cells: {
              "90": { [todayYmd]: 5e9 },
              "108": { [todayYmd]: 1e9 },
              "92": { [todayYmd]: -1e9 },
            },
          },
          vex: {
            // VEX is deliberately left unconstrained (no above/below-spot geometry) — the fixture
            // reuses the same shape so a regression here would be caught the same way.
            flip: 99,
            strike_totals: { "90": 5e9, "108": 1e9 },
          },
        };
      }
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

mock.module("./vector-wall-write", {
  namedExports: {
    writeWallHistorySample: async (opts: {
      sessionYmd: string;
      ticker: string;
      horizon?: string;
      sample: { walls?: { callWalls?: { strike: number }[]; putWalls?: { strike: number }[] } };
    }) => {
      wallSampleCalls.push(`${opts.sessionYmd}:${opts.ticker}`);
      wallSampleWrites.push({ ticker: opts.ticker, horizon: opts.horizon, sample: opts.sample });
      return { written: true };
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
let recordVectorUniverseWallSample: typeof import("./vector-universe").recordVectorUniverseWallSample;

before(async () => {
  const mod = await import("./vector-universe");
  buildVectorUniverseSnapshot = mod.buildVectorUniverseSnapshot;
  ensureTickerInUniverseSnapshot = mod.ensureTickerInUniverseSnapshot;
  loadVectorUniverseSnapshot = mod.loadVectorUniverseSnapshot;
  warmDynamicTickerSessionWall = mod.warmDynamicTickerSessionWall;
  recordVectorUniverseWallSample = mod.recordVectorUniverseWallSample;
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

// Regression for the 2026-09-04 audit finding: buildVectorUniverseSnapshot fired every universe
// ticker's fetchGexHeatmap via a raw Promise.allSettled (no concurrency bound), which shares the
// app-wide Polygon admission limiter with live desk/GEX/pulse traffic and a fixed 3s per-ticker
// serve cap — reproduced live as several genuinely-available tickers (DIA/AAOI/DRAM/ZS/NOK) coming
// back fully null from GET /api/market/vector/universe while a solo, uncontended
// GET /api/market/gex-heatmap for each succeeded. Fixed by routing the fan-out through
// runPolygonPool (polygon-rate-limiter.ts); this proves the SNAPSHOT BUILDER actually uses the
// bounded pool (not just that the pool primitive itself is bounded — see runPolygonPool's own
// coverage in polygon-rate-limiter.test.ts).
test("buildVectorUniverseSnapshot: bounds concurrent fetchGexHeatmap calls via runPolygonPool", async () => {
  dynamicTickers = Array.from({ length: 20 }, (_, i) => `CONC${i}`);
  fetchCalls = [];
  fetchInFlight = 0;
  maxFetchInFlight = 0;
  cacheStore = null;

  const snap = await buildVectorUniverseSnapshot();

  assert.equal(snap.rows.length, 23, "all 20 CONC tickers plus the 3 static tickers must still produce rows");
  assert.ok(maxFetchInFlight <= 8, `expected at most 8 concurrent fetchGexHeatmap calls (POOL_MAX_CONCURRENCY default), saw ${maxFetchInFlight}`);
  assert.ok(maxFetchInFlight > 1, "sanity: the pool should actually overlap work, not degrade to fully sequential");
});

// Regression for the 2026-09-04 audit finding: buildVectorUniverseRow's GEX (gamma) wall
// computation didn't pass spot into computeGexWalls, so a call wall could serve BELOW spot (or a
// put wall ABOVE it) — reproduced live on SPX (spot 7747.71, topPutWall 8000) and 17-18 other
// tickers via GET /api/market/vector/universe.
test("buildVectorUniverseSnapshot: GEX wall never lands on the wrong side of spot", async () => {
  dynamicTickers = ["INVERT"];
  fetchCalls = [];
  cacheStore = null;

  const snap = await buildVectorUniverseSnapshot();
  const row = snap.rows.find((r) => r.ticker === "INVERT");
  assert.ok(row, "INVERT row must be present");
  // Fixture: strike 90 (below spot 100) carries 5e9 |gamma|, strike 108 (above spot) carries 1e9 —
  // unconstrained picks 90 as "the call wall" (resistance below spot); constrained must pick 108.
  assert.equal(row!.topCallWall, 108, "GEX call wall must sit above spot, not the higher-|gamma| below-spot strike");
  assert.equal(row!.topPutWall, 92, "GEX put wall must sit below spot");
  assert.ok(row!.topCallPct != null && row!.topCallPct > 0, "pct must still be populated for the constrained pick");
});

// Regression for the 2026-09-04 audit follow-up to #3495: buildVectorUniverseRow's narrowed-
// horizon writer (`horizonWalls`, feeding the durable 0dte/weekly/monthly wall-history rails via
// writeWallHistorySample) called computeGexWalls WITHOUT spot even though the main gexWalls
// computation a few lines above it already had the fix. Same fixture shape as INVERT above,
// carried through `gex.cells`/`expiries` instead of the blended `strike_totals`.
test("recordVectorUniverseWallSample: narrowed-horizon (0dte) wall write never lands on the wrong side of spot", async () => {
  wallSampleWrites = [];
  wallSampleCalls = [];

  await recordVectorUniverseWallSample("INVERT", { sessionYmd: "2026-09-04" });

  const zeroDte = wallSampleWrites.find((w) => w.ticker === "INVERT" && w.horizon === "0dte");
  assert.ok(zeroDte, "0dte narrowed-horizon sample must be written");
  const callWalls = zeroDte!.sample.walls?.callWalls ?? [];
  const putWalls = zeroDte!.sample.walls?.putWalls ?? [];
  assert.deepEqual(
    callWalls.map((w) => w.strike),
    [108],
    "narrowed-horizon call wall must sit above spot (100), not the higher-|gamma| strike 90 below it"
  );
  assert.deepEqual(
    putWalls.map((w) => w.strike),
    [92],
    "narrowed-horizon put wall must sit below spot"
  );
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

test("vector-universe: GEX walls require positive spot (source scan)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./vector-universe.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /hm\?\.gex\?\.strike_totals && spot != null && spot > 0/,
    "blended GEX walls must fail-closed when spot is missing"
  );
  assert.match(
    src,
    /recordNarrowedHorizons && spot != null && spot > 0 && hm\?\.gex\?\.cells/,
    "narrowed-horizon writes must skip when spot is missing"
  );
  assert.doesNotMatch(src, /spot:\s*spot\s*\?\?\s*undefined/, "must not pass raw spot ?? undefined to computeGexWalls");
});
