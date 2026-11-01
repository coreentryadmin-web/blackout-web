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
// Without this, an unmocked resolveSpotFromUwStockState (the GET handler's fallback after
// getRestQuote returns null) makes a REAL network call to UW on every failing-ticker poll —
// unbounded by wall-clock time and by the real UW rate limiter, so it can log its own
// unrelated "[uw] queue wait ...ms" warning (unusual-whales.ts) well after this test's own
// try/finally has already restored console.warn, landing in whichever LATER test happens to
// still have its own console.warn override installed. That is a real, reproduced flake this
// suite hit (route.test.ts's second test failed on a queue-wait warning it never triggered) —
// mock the fallback so this suite tests ONLY the Polygon REST negative-cache it documents.
mock.module("../../../../lib/providers/spot-fallback", {
  namedExports: {
    resolveSpotFromUwStockState: async () => null,
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

  test("rounds IEEE float noise at the response boundary", async () => {
    mockStockSnapshot = { price: 7499.360000000001, change_pct: 0.123456789 };
    const res = await GET(new NextRequest("http://localhost/api/market/quote?ticker=QQQ"));
    const body = await res.json();
    assert.equal(body.available, true);
    assert.equal(body.price, 7499.36);
    assert.equal(body.change_pct, 0.12);
  });

  // Regression: quoteFailureWarned (the de-duped-warning Set) had NO size bound, unlike its
  // sibling quoteFailureMem (cleared at size>200 — see recordQuoteFailure). Entries are only
  // removed on a per-ticker SUCCESS, so a ticker that never recovers — or a sustained spread of
  // distinct failing tickers (bot/probing traffic hitting many invalid-but-allowlisted symbols)
  // — grew the Set for the life of the process with no eviction. Proven here by the only
  // observable symptom: a long-suppressed ticker's warning re-arms once the Set clears, instead
  // of staying suppressed forever.
  test("quoteFailureWarned is bounded — a long spread of distinct failing tickers eventually re-arms a long-suppressed ticker's warning", async () => {
    mockStockSnapshot = null;
    warnCalls = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnCalls.push(String(args[0])); };
    try {
      await GET(new NextRequest("http://localhost/api/market/quote?ticker=SENT1"));
      assert.equal(warnCalls.length, 1, "first failure for the sentinel ticker warns once");

      await GET(new NextRequest("http://localhost/api/market/quote?ticker=SENT1"));
      assert.equal(warnCalls.length, 1, "immediate repeat failure stays suppressed (negative cache)");

      // Flood with 201 distinct NEW failing tickers so the Set crosses the 200-entry bound at
      // least once. Without a bound, this just grows quoteFailureWarned forever and SENT1 stays
      // suppressed indefinitely regardless of how many other tickers fail.
      for (let i = 0; i < 201; i++) {
        const ticker = `Q${String(i).padStart(6, "0")}`; // 7 chars — matches the ^[A-Z0-9.-]{1,8}$ allowlist
        await GET(new NextRequest(`http://localhost/api/market/quote?ticker=${ticker}`));
      }

      const warnCountBeforeRecheck = warnCalls.length;
      await GET(new NextRequest("http://localhost/api/market/quote?ticker=SENT1"));
      assert.equal(
        warnCalls.length,
        warnCountBeforeRecheck + 1,
        "quoteFailureWarned must be bounded: once it clears, SENT1 can warn again instead of being suppressed forever by an ever-growing Set"
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});
