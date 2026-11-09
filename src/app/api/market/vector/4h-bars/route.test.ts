import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Schema/shape test for the 4h-bars route (CTO audit P2 — "4h remains open"), mirroring the
// gex-ladder route test's mock.module() pattern: the pure modules (vector-ticker,
// vector-4h-bars, vector-bar-timeframes, round-floats, no-store-headers, the ET session
// helpers) run for real; only the auth gates + the Polygon minute-bar fetchers are faked so
// this test doesn't hit the network and doesn't depend on market hours.
//
// mock.module() resolves bare specifiers relative to THIS file.

let indexCalls = 0;
let stockCalls = 0;
let tslaCalls = 0;

mock.module("../../../../../lib/market-api-auth", {
  namedExports: {
    authorizePremiumDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: {
    requireToolApi: async () => null, // not locked
  },
});
mock.module("../../../../../lib/providers/polygon", {
  namedExports: {
    // Only the FIRST (most recent) trading day returns bars — mimics a real walk-back where
    // older sessions are all empty once enough sessions have been seen — so the route's
    // per-day loop + reverse/flatten logic is actually exercised, not just a happy path where
    // every day has data.
    fetchIndexMinuteBars: async (_sym: string, from: string, to: string) => {
      indexCalls++;
      if (indexCalls > 1) return [];
      return [
        { t: Date.UTC(2026, 0, 5, 14, 31, 0), o: 100, h: 101, l: 99, c: 100.5, v: 10 },
        { t: Date.UTC(2026, 0, 5, 14, 32, 0), o: 100.5, h: 102, l: 100, c: 101, v: 20 },
        { t: Date.UTC(2026, 0, 5, 18, 5, 0), o: 101, h: 103, l: 100.5, c: 102, v: 30 },
      ];
    },
    // TSLA's day 1 (most recent) succeeds with real bars, day 2 THROWS (a genuine upstream
    // failure — not "legitimately no data"), and the rest are legitimately empty. Isolated from
    // the plain `fetchStockMinuteBars` fixture below by ticker/symbol so the AAPL test is
    // unaffected.
    fetchStockMinuteBars: async (sym: string, from: string, to: string) => {
      if (sym === "TSLA") {
        tslaCalls++;
        if (tslaCalls === 1) {
          return [{ t: Date.UTC(2026, 0, 5, 14, 31, 0), o: 200, h: 201, l: 199, c: 200.5, v: 40 }];
        }
        if (tslaCalls === 2) throw new Error("upstream blip");
        return [];
      }
      stockCalls++;
      if (stockCalls > 1) return [];
      return [{ t: Date.UTC(2026, 0, 5, 14, 31, 0), o: 50, h: 51, l: 49, c: 50.5, v: 100 }];
    },
  },
});

// Spy on the shared cache so the write-gate (cache only a REAL, COMPLETE result) can be asserted
// directly, isolated from the real module's Redis/in-memory fallback (which would otherwise let
// one test's successful write silently serve a later test's request for the same ticker).
let sharedCacheSetCalls: Array<{ key: string; value: unknown }> = [];
mock.module("../../../../../lib/shared-cache", {
  namedExports: {
    sharedCacheGet: async () => null,
    sharedCacheSet: async (key: string, value: unknown) => {
      sharedCacheSetCalls.push({ key, value });
    },
  },
});

describe("/api/market/vector/4h-bars", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("ships no-store headers", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/vector/4h-bars?ticker=SPX"));
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
    assert.equal(res.headers.get("CDN-Cache-Control"), "no-store");
  });

  test("index ticker (SPX): fetches minute bars via fetchIndexMinuteBars and aggregates to 4h buckets", async () => {
    indexCalls = 0;
    const res = await GET(new NextRequest("http://localhost/api/market/vector/4h-bars?ticker=SPX"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ticker, "SPX");
    assert.equal(body.unit, "4H");
    assert.ok(Array.isArray(body.bars));
    // Two of the three fixture bars (14:31, 14:32 UTC = ET 09:31/09:32) share the same 4h ET
    // bucket; the third (18:05 UTC = ET 13:05) falls in the next one — so 3 raw bars collapse
    // to 2 candles.
    assert.equal(body.bars.length, 2);
    assert.equal(body.bars[0].open, 100);
    assert.equal(body.bars[0].close, 101);
    assert.equal(body.bars[0].volume, 30); // 10 + 20 summed within the shared bucket
    assert.equal(body.bars[1].open, 101);
    assert.equal(body.bars[1].close, 102);
    assert.ok(body.bars[0].time < body.bars[1].time);
  });

  test("stock ticker: fetches minute bars via fetchStockMinuteBars", async () => {
    stockCalls = 0;
    const res = await GET(new NextRequest("http://localhost/api/market/vector/4h-bars?ticker=AAPL"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ticker, "AAPL");
    assert.equal(body.bars.length, 1);
    assert.equal(body.bars[0].open, 50);
  });

  test("junk ticker 400 is also no-store", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/vector/4h-bars?ticker=%20%20"));
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("CDN-Cache-Control"), "no-store");
  });

  test("a genuine per-day fetch failure still returns the best-effort bars it has, but is NOT cached", async () => {
    tslaCalls = 0;
    sharedCacheSetCalls = [];
    const res = await GET(new NextRequest("http://localhost/api/market/vector/4h-bars?ticker=TSLA"));
    assert.equal(res.status, 200);
    const body = await res.json();
    // The one real, successful day's bar still reaches the response — a partial failure must
    // never blank the whole chart.
    assert.equal(body.bars.length, 1);
    assert.equal(body.bars[0].open, 200);
    // But because one of the twelve days' fetches genuinely THREW (not "legitimately empty"),
    // the result is incomplete and must not be pinned in the shared cache for the next
    // CACHE_TTL_SEC — the next request should retry the failed day, not be served this same
    // hole in the series for two more minutes.
    assert.equal(
      sharedCacheSetCalls.length,
      0,
      "a result built from a genuine per-day fetch failure must not be cached"
    );
  });

  test("an all-succeed result (including legitimately-empty older days) IS cached", async () => {
    indexCalls = 0;
    sharedCacheSetCalls = [];
    const res = await GET(new NextRequest("http://localhost/api/market/vector/4h-bars?ticker=SPX"));
    assert.equal(res.status, 200);
    assert.equal(
      sharedCacheSetCalls.length,
      1,
      "a fully-successful result (no day's fetch threw) should still be cached as before"
    );
  });
});
