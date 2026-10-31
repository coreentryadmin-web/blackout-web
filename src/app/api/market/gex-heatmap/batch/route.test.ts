import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression (round 191 audit): the Thermal compare-grid batch endpoint fanned out one
// `loadHeatmapCacheReaderOnly` call per ticker inside a bare `Promise.all`, with NO try/catch
// anywhere in the route and no equivalent of the single-ticker route's top-level
// `try { ... } catch (error) { return { available: false } }` safety net (see
// src/app/api/market/gex-heatmap/route.ts). `loadHeatmapCacheReaderOnly`'s forceRefresh branch
// awaits `fetchGexHeatmap(ticker, { forceRefresh: true })` directly with no `.catch()`, so an
// upstream failure for ONE ticker (a bad/forced chain fetch erroring) rejects `Promise.all` for
// the WHOLE request — every other ticker that fetched fine is lost too, and the route has no
// catch block to turn that into a graceful partial response the way the sibling single-ticker
// route and `memberPayloadFromHeatmap` already do for a null/empty heatmap.
//
// mock.module() resolves bare specifiers relative to THIS file, same pattern as the sibling
// ../route.test.ts.

mock.module("server-only", { namedExports: {} });
mock.module("../../../../../lib/market-api-auth", {
  namedExports: {
    authorizeMarketDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: {
    requireAnyToolApi: async () => null, // tool launched — never gate the test
  },
});
mock.module("../../../../../lib/providers/polygon-options-gex", {
  namedExports: {
    peekGexHeatmapCache: async () => ({
      ticker: "X",
      cached: false,
      last_compute_at: null,
      age_sec: null,
      ttl_sec: 5,
      stale: true,
      spot: null,
      events_count: null,
    }),
  },
});
mock.module("../../../../../lib/ws/uw-socket", {
  namedExports: {
    joinGexStrikeExpiryTicker: () => {},
  },
});
mock.module("../../../../../features/vector/lib/vector-universe", {
  namedExports: {
    registerVectorUniverseView: () => {},
  },
});

/** Per-ticker behaviour the test controls: resolve to a stub payload, or reject like a real
 *  upstream fetch failure (fetchGexHeatmap rejecting under a forced refresh). */
let perTickerLoad: Map<string, "ok" | "reject"> = new Map();

mock.module("../../../../../lib/gex-heatmap-member-serve", {
  namedExports: {
    loadHeatmapCacheReaderOnly: async (ticker: string) => {
      const mode = perTickerLoad.get(ticker) ?? "ok";
      if (mode === "reject") throw new Error(`upstream chain fetch failed for ${ticker}`);
      return { underlying: ticker, spot: 100, strikes: [100] } as never;
    },
    memberPayloadFromHeatmap: (heatmap: unknown) =>
      heatmap ? { underlying: (heatmap as { underlying: string }).underlying, available: true } : null,
    scheduleHeatmapBackgroundWarm: () => {},
  },
});

function req(tickers: string) {
  return new NextRequest(
    `https://blackouttrades.com/api/market/gex-heatmap/batch?tickers=${encodeURIComponent(tickers)}`
  );
}

describe("GET /api/market/gex-heatmap/batch — per-ticker isolation", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("one ticker's upstream failure does not take down the whole batch", async () => {
    perTickerLoad = new Map([
      ["GOOD", "ok"],
      ["BAD", "reject"],
    ]);

    const res = await GET(req("GOOD,BAD"));
    assert.equal(res.status, 200);
    const body = await res.json();
    // The healthy ticker must still be served...
    assert.ok(body.tickers.GOOD, "GOOD ticker should still be present in the batch response");
    // ...and the failing one is gracefully omitted, never a thrown/rejected request.
    assert.ok(!body.tickers.BAD, "BAD ticker should be omitted, not crash the batch");
  });

  test("every ticker failing still returns 200 with an empty map, never a rejection", async () => {
    perTickerLoad = new Map([
      ["BAD1", "reject"],
      ["BAD2", "reject"],
    ]);

    const res = await GET(req("BAD1,BAD2"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.tickers, {});
  });

  test("all-healthy batch is unaffected (no regression on the happy path)", async () => {
    perTickerLoad = new Map([
      ["AAA", "ok"],
      ["BBB", "ok"],
    ]);

    const res = await GET(req("AAA,BBB"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.tickers.AAA);
    assert.ok(body.tickers.BBB);
  });
});
