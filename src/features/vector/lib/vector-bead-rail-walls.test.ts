import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

mock.module("../../../lib/ws/stock-candle-store", {
  namedExports: {
    getStockLiveCandle: () => ({ current: null, updatedAt: 0, changePct: 0 }),
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

let getVectorBeadRailGexWalls: typeof import("./vector-snapshot").getVectorBeadRailGexWalls;
let getVectorGexWalls: typeof import("./vector-snapshot").getVectorGexWalls;
let _resetVectorSnapshotForTest: typeof import("./vector-snapshot")._resetVectorSnapshotForTest;
let primeVectorWallScope: typeof import("./vector-snapshot").primeVectorWallScope;

before(async () => {
  const mod = await import("./vector-snapshot");
  getVectorBeadRailGexWalls = mod.getVectorBeadRailGexWalls;
  getVectorGexWalls = mod.getVectorGexWalls;
  _resetVectorSnapshotForTest = mod._resetVectorSnapshotForTest;
  primeVectorWallScope = mod.primeVectorWallScope;
  _resetVectorSnapshotForTest();
  heatmapPayload = null;
});

test("getVectorBeadRailGexWalls: unconstrained when spot unknown (Sep-3 bead density)", async () => {
  _resetVectorSnapshotForTest();
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
  const walls = getVectorBeadRailGexWalls("IBIT");
  assert.ok(walls);
  assert.equal(walls!.callWalls[0]?.strike, 46, "bead rail keeps below-spot strike 46");
});

test("getVectorGexWalls: overlay stays spot-constrained when spot is available", async () => {
  _resetVectorSnapshotForTest();
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
  assert.equal(walls!.callWalls[0]?.strike, 47, "overlay call wall must sit above spot");
});

test("vector-snapshot: bead recording uses getVectorBeadRailGexWalls", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./vector-snapshot.ts", import.meta.url), "utf8");
  assert.match(src, /getVectorBeadRailGexWalls\(t\)/, "stream/recorder must read bead-rail walls");
  assert.match(
    src,
    /gexWalls: gexRecordable \? beadRailWalls : null/,
    "wall-history sample must persist bead-rail walls, not overlay walls"
  );
});
