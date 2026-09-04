import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const stockCandle = {
  current: null as { close: number } | null,
  updatedAt: 0,
  changePct: 0,
};

// Relative specifiers — mock.module does not resolve @/ aliases (see flow-gex-enrichment.test.ts).
mock.module("../../../lib/ws/stock-candle-store", {
  namedExports: {
    getStockLiveCandle: () => stockCandle,
  },
});

mock.module("../../../lib/ws/spx-candle-store", {
  namedExports: {
    getCurrentSpxCandle: () => ({ current: null, updatedAt: 0 }),
  },
});

mock.module("../../../lib/ws/uw-socket", {
  namedExports: {
    hasLiveGexStrikeExpiry: () => false,
    getGexStrikeExpiryLadder: () => null,
    joinGexStrikeExpiryTicker: () => {},
  },
});

let heatmapPayload: {
  spot?: number;
  gex?: { strike_totals: Record<string, number> };
} | null = null;

mock.module("../../../lib/providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async () => heatmapPayload,
  },
});

let getVectorGexWalls: typeof import("./vector-snapshot").getVectorGexWalls;
let _resetVectorSnapshotForTest: typeof import("./vector-snapshot")._resetVectorSnapshotForTest;
let primeVectorWallScope: typeof import("./vector-snapshot").primeVectorWallScope;

before(async () => {
  const mod = await import("./vector-snapshot");
  getVectorGexWalls = mod.getVectorGexWalls;
  _resetVectorSnapshotForTest = mod._resetVectorSnapshotForTest;
  primeVectorWallScope = mod.primeVectorWallScope;
  _resetVectorSnapshotForTest();
  stockCandle.current = null;
  heatmapPayload = null;
});

test("getVectorGexWalls fails closed when strike totals exist but spot is unknown", async () => {
  _resetVectorSnapshotForTest();
  stockCandle.current = null;
  heatmapPayload = {
    gex: {
      strike_totals: {
        "46": 5e8,
        "47": 2e8,
        "45": -3e8,
      },
    },
  };
  await primeVectorWallScope("IBIT");
  assert.equal(getVectorGexWalls("IBIT"), null);
});

test("getVectorGexWalls side-constrains when heatmap spot is available", async () => {
  _resetVectorSnapshotForTest();
  stockCandle.current = null;
  heatmapPayload = {
    spot: 46.06,
    gex: {
      strike_totals: {
        "46": 5e8,
        "47": 2e8,
        "45": -3e8,
      },
    },
  };
  await primeVectorWallScope("IBIT");
  const walls = getVectorGexWalls("IBIT");
  assert.ok(walls);
  assert.equal(walls!.callWalls[0]?.strike, 47, "call wall must sit above spot");
  assert.equal(walls!.putWalls[0]?.strike, 45, "put wall must sit below spot");
});

test("getVectorGexWalls uses live candle close when heatmap spot is missing", async () => {
  _resetVectorSnapshotForTest();
  stockCandle.current = { close: 46.06 };
  heatmapPayload = {
    gex: {
      strike_totals: {
        "46": 5e8,
        "47": 2e8,
        "45": -3e8,
      },
    },
  };
  await primeVectorWallScope("IBIT");
  const walls = getVectorGexWalls("IBIT");
  assert.ok(walls);
  assert.equal(walls!.callWalls[0]?.strike, 47);
  assert.ok(walls!.callWalls.every((w) => w.strike > 46.06));
});
