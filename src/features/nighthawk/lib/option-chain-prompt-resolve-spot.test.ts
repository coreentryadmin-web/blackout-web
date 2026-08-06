import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// NH-R12 regression: resolveSpot (BREAKOUT/PIN discovery's spot-price lookup) never
// applied board.ts's polygonSpotTicker mapping before hitting Polygon's STOCK-namespace
// endpoints. board.ts documents (2026-07-13, live-verified) that those stock endpoints
// return an empty/zero result for index option roots (SPXW, NDXP, RUTW, XSP, …) — the
// index itself only prices under the `I:` namespace. That mapping was already applied
// for grading/spot-bar reads in scan.ts/skip-grading.ts; this file's resolveSpot was the
// one remaining caller that skipped it, so an index-root ticker flowing through BREAKOUT
// or PIN discovery silently resolved to spot=0 (or a stale/absent dossier guess) instead
// of a real index price.
//
// This suite pins that resolveSpot now maps index roots to `I:*` before calling
// getStockLiveCandle/fetchStockSnapshot, and — since the STOCK snapshot endpoint is a
// different endpoint entirely from the indices snapshot endpoint (see
// src/app/api/market/quote/route.ts's existing isIndexRoot branch) — that the REST
// fallback for an index root goes to fetchIndexSnapshot, not fetchStockSnapshot("I:...").
// mock.module() resolves bare specifiers relative to THIS file, matching the pattern in
// src/app/api/market/quote/route.test.ts / src/app/api/platform/intel/route.test.ts.

let liveCandleCalls: string[] = [];
let stockSnapshotCalls: string[] = [];
let indexSnapshotCalls: string[] = [];
let mockIndexPrice: number | null = null;
let mockStockPrice: number | null = null;

mock.module("../../../lib/ws/stock-candle-store", {
  namedExports: {
    getStockLiveCandle: (ticker: string) => {
      liveCandleCalls.push(ticker);
      return { current: null, updatedAt: 0, changePct: 0 };
    },
  },
});
mock.module("../../../lib/providers/polygon", {
  namedExports: {
    fetchStockSnapshot: async (ticker: string) => {
      stockSnapshotCalls.push(ticker);
      return mockStockPrice != null ? { price: mockStockPrice, change_pct: 0 } : null;
    },
    fetchIndexSnapshot: async (ticker: string) => {
      indexSnapshotCalls.push(ticker);
      return mockIndexPrice != null ? { price: mockIndexPrice, change_pct: 0 } : null;
    },
  },
});

let resolveSpot: typeof import("./option-chain-prompt").resolveSpot;

before(async () => {
  ({ resolveSpot } = await import("./option-chain-prompt"));
});

test("resolveSpot: an index-root ticker (SPXW) maps to I:SPX and resolves via fetchIndexSnapshot, not fetchStockSnapshot", async () => {
  liveCandleCalls = [];
  stockSnapshotCalls = [];
  indexSnapshotCalls = [];
  mockIndexPrice = 6543.21;
  mockStockPrice = null;

  const spot = await resolveSpot("SPXW");

  assert.equal(spot, 6543.21);
  assert.deepEqual(liveCandleCalls, ["I:SPX"]);
  assert.deepEqual(indexSnapshotCalls, ["I:SPX"]);
  assert.deepEqual(stockSnapshotCalls, [], "must not call the stock-namespace snapshot for an index root");
});

test("resolveSpot: NDXP (PM-settled NDX root) maps to I:NDX", async () => {
  liveCandleCalls = [];
  stockSnapshotCalls = [];
  indexSnapshotCalls = [];
  mockIndexPrice = 20111.5;
  mockStockPrice = null;

  const spot = await resolveSpot("NDXP");

  assert.equal(spot, 20111.5);
  assert.deepEqual(indexSnapshotCalls, ["I:NDX"]);
  assert.deepEqual(stockSnapshotCalls, []);
});

test("resolveSpot: a real equity/ETF ticker (NVDA) is unaffected — passes through to fetchStockSnapshot", async () => {
  liveCandleCalls = [];
  stockSnapshotCalls = [];
  indexSnapshotCalls = [];
  mockIndexPrice = null;
  mockStockPrice =181.4;

  const spot = await resolveSpot("NVDA");

  assert.equal(spot, 181.4);
  assert.deepEqual(liveCandleCalls, ["NVDA"]);
  assert.deepEqual(stockSnapshotCalls, ["NVDA"]);
  assert.deepEqual(indexSnapshotCalls, []);
});

test("resolveSpot: a dossier price still short-circuits before any lookup (unchanged behavior)", async () => {
  liveCandleCalls = [];
  stockSnapshotCalls = [];
  indexSnapshotCalls = [];

  const spot = await resolveSpot("SPXW", { tech: { price: 6600 } } as any);

  assert.equal(spot, 6600);
  assert.deepEqual(liveCandleCalls, []);
  assert.deepEqual(stockSnapshotCalls, []);
  assert.deepEqual(indexSnapshotCalls, []);
});
