import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression: getRestQuote had no negative-result cache, so a sustained upstream outage
// meant every poll (from every open tab, every replica) re-hit the upstream with zero
// backoff, and every single failure logged its own console.warn — a wall of log noise for
// the duration of the outage. mock.module() resolves bare specifiers relative to THIS file
// (not the "@/" tsconfig alias) — see src/app/api/platform/intel/route.test.ts for the same
// pattern. route.ts is imported once in before() since ESM caches a module on first import.

let stockSnapshotCalls = 0;
let mockStockSnapshot: { price: number; change_pct: number } | null = null;

mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    authorizeMarketDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});
mock.module("../../../../lib/ws/init-data-sockets", {
  namedExports: { ensureDataSockets: () => {} },
});
mock.module("../../../../lib/ws/polygon-socket", {
  namedExports: { indexStore: {} },
});
mock.module("../../../../lib/providers/polygon-options-gex", {
  namedExports: {
    resolveOptionsRoot: (ticker: string) => ({ root: ticker, optionsRoot: ticker }),
  },
});
mock.module("../../../../lib/providers/polygon", {
  namedExports: {
    fetchStockSnapshot: async () => {
      stockSnapshotCalls++;
      return mockStockSnapshot;
    },
    fetchIndexSnapshot: async () => null,
  },
});
mock.module("../../../../lib/shared-cache", {
  namedExports: {
    sharedCacheGet: async () => null,
    sharedCacheSet: async () => {},
  },
});

describe("/api/market/quote negative-result caching", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  let warnCalls: string[];
  let originalWarn: typeof console.warn;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("a failed upstream snapshot returns available:false and logs one warning", async () => {
    stockSnapshotCalls = 0;
    mockStockSnapshot = null;
    warnCalls = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnCalls.push(String(args[0])); };
    try {
      const res = await GET(new NextRequest("http://localhost/api/market/quote?ticker=ZZZZ"));
      const body = await res.json();
      assert.equal(body.available, false);
      assert.equal(stockSnapshotCalls, 1);
      assert.equal(warnCalls.length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("a second poll within the negative-cache window does NOT re-hit the upstream or re-warn", async () => {
    // stockSnapshotCalls/warnCalls carry over from the previous test's failure — same ticker,
    // still within QUOTE_FAILURE_CACHE_MS (3s) since the tests run back-to-back.
    const callsBefore = stockSnapshotCalls;
    warnCalls = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnCalls.push(String(args[0])); };
    try {
      const res = await GET(new NextRequest("http://localhost/api/market/quote?ticker=ZZZZ"));
      const body = await res.json();
      assert.equal(body.available, false);
      assert.equal(stockSnapshotCalls, callsBefore, "negative cache should skip the upstream call entirely");
      assert.equal(warnCalls.length, 0, "no repeat warning while still within the outage window");
    } finally {
      console.warn = originalWarn;
    }
  });

  test("a successful snapshot for a different ticker is unaffected by another ticker's failure cache", async () => {
    mockStockSnapshot = { price: 123.45, change_pct: 1.23 };
    const res = await GET(new NextRequest("http://localhost/api/market/quote?ticker=SPY"));
    const body = await res.json();
    assert.equal(body.available, true);
    assert.equal(body.price, 123.45);
  });
});
