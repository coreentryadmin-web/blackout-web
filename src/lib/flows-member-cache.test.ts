import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { flowsMemberCacheKey, FLOWS_WARM_LIMITS } from "@/lib/flows-member-cache-key";

describe("flowsMemberCacheKey", () => {
  it("matches the HELIX flows route head-page key shape", () => {
    assert.equal(flowsMemberCacheKey({ pageLimit: 30 }), "flows:pg:168:0:all:any:30");
    assert.equal(
      flowsMemberCacheKey({ pageLimit: 500, min_premium: 200_000 }),
      "flows:pg:168:200000:all:any:500"
    );
  });

  it("warm limits cover site-latency probe and desk default", () => {
    assert.deepEqual(FLOWS_WARM_LIMITS, [30, 500]);
  });
});

// mock.module() must be registered before flows-member-cache.ts (and therefore its dependency
// imports: db, flow-gex-enrichment, server-cache) is ever loaded — same ordering requirement
// (and the same Node 20 "always the RELATIVE path, never the @/ alias" gotcha) as
// admin-gex-health.test.ts's own header comment documents. The module under test is loaded
// dynamically inside before().

type FlowRow = { alerted_at: string; event_at?: string | null; ticker: string; strike: number };

let fetchRecentFlowsImpl: (params: Record<string, unknown>) => Promise<FlowRow[]> = async () => [];

mock.module("./db", {
  namedExports: {
    fetchRecentFlows: async (params: Record<string, unknown>) => fetchRecentFlowsImpl(params),
  },
});

mock.module("./flow-gex-enrichment", {
  namedExports: {
    // Identity enrichment — the fallback-scoping bug under test has nothing to do with GEX
    // proximity, so this just needs to round-trip rows unchanged.
    enrichFlowsWithGex: async (rows: FlowRow[]) =>
      rows.map((r) => ({ ...r, gex_evaluated: false })),
  },
});

// Stands in for server-cache's real withServerCache: the real function's own cold-miss /
// inflight-race branches (documented at server-cache.ts, which names THIS module as a caller
// that reaches them) are what actually invoke `opts.fallback()` in production. This mock lets
// the test drive that exact branch deterministically instead of racing real timers.
let withServerCacheImpl: (
  key: string,
  ttlMs: number,
  loader: () => Promise<unknown>,
  opts: { fallback: () => Promise<unknown> }
) => Promise<unknown> = (_key, _ttl, loader) => loader();

mock.module("./server-cache", {
  namedExports: {
    peekServerCache: async () => null,
    withServerCache: async (
      key: string,
      ttlMs: number,
      loader: () => Promise<unknown>,
      opts: { fallback: () => Promise<unknown> }
    ) => withServerCacheImpl(key, ttlMs, loader, opts),
  },
});

let readFlowsMemberCached: typeof import("./flows-member-cache").readFlowsMemberCached;
let MAX_LAST_GOOD_FLOWS_KEYS: typeof import("./flows-member-cache").MAX_LAST_GOOD_FLOWS_KEYS;

before(async () => {
  ({ readFlowsMemberCached, MAX_LAST_GOOD_FLOWS_KEYS } = await import("./flows-member-cache"));
});

describe("readFlowsMemberCached: per-query fallback scoping", () => {
  it("a cold/degraded query never gets served a DIFFERENT query's cached rows as its fallback", async () => {
    // Query A (ticker=NVDA) builds successfully through the real loader path — this is what
    // populates the module's "last good" substitute for ITS OWN cache key.
    fetchRecentFlowsImpl = async () => [
      { alerted_at: "2026-01-01T00:00:00Z", ticker: "NVDA", strike: 100 },
    ];
    withServerCacheImpl = (_key, _ttl, loader) => loader();
    const a = await readFlowsMemberCached({ pageLimit: 10, ticker: "NVDA" });
    assert.equal(a.count, 1);
    assert.equal((a.flows[0] as unknown as FlowRow).ticker, "NVDA");

    // Query B (ticker=TSLA, a DIFFERENT cache key) is cold — simulate withServerCache taking its
    // own documented fallback branch (cold key racing maxBlockMs, or a concurrent inflight build
    // with no stale/Redis copy) by calling opts.fallback() directly instead of the loader.
    withServerCacheImpl = (_key, _ttl, _loader, opts) => opts.fallback();
    const b = await readFlowsMemberCached({ pageLimit: 10, ticker: "TSLA" });

    // The TSLA query never built anything of its own — it must fall through to the honest empty
    // payload, never to NVDA's rows left behind by an unrelated query.
    assert.equal(b.count, 0, "must not serve a different query's rows as this query's fallback");
    assert.deepEqual(b.flows, []);
    assert.equal(b.degraded, true, "a substituted/empty fallback must be marked degraded");
  });

  it("a cold/degraded query DOES get its own prior-good rows back once its own key has built once", async () => {
    fetchRecentFlowsImpl = async () => [
      { alerted_at: "2026-01-01T00:00:00Z", ticker: "META", strike: 500 },
    ];
    withServerCacheImpl = (_key, _ttl, loader) => loader();
    const first = await readFlowsMemberCached({ pageLimit: 10, ticker: "META" });
    assert.equal(first.count, 1);

    // Same query (same ticker/pageLimit → same cache key) goes cold on a later poll.
    withServerCacheImpl = (_key, _ttl, _loader, opts) => opts.fallback();
    const second = await readFlowsMemberCached({ pageLimit: 10, ticker: "META" });
    assert.equal(second.count, 1, "this query's own last-good rows should still be servable");
    assert.equal((second.flows[0] as unknown as FlowRow).ticker, "META");
  });
});

describe("lastGoodFlowsPayloadByKey: bounded growth", () => {
  it("does not retain every distinct min_premium query forever — old entries get evicted", async () => {
    // `min_premium` is a caller-supplied float (the HELIX tape's filter, straight off the
    // `/api/market/flows?min_premium=` query param) and folds directly into the cache key
    // (flows-member-cache-key.ts). A member sweeping that filter (or simply many members using
    // different thresholds over a long-running process) can generate unbounded distinct keys.
    // Build this query's own "last good" entry once, cheaply, by going through the real loader.
    withServerCacheImpl = (_key, _ttl, loader) => loader();

    const firstPremium = 1;
    fetchRecentFlowsImpl = async () => [
      { alerted_at: "2026-01-01T00:00:00Z", ticker: "SPY", strike: 1 },
    ];
    const warmed = await readFlowsMemberCached({ pageLimit: 10, min_premium: firstPremium });
    assert.equal(warmed.count, 1, "sanity: the first distinct min_premium query built real rows");

    // Drive the map past its cap with MANY other distinct min_premium values — the exact shape of
    // unbounded growth this regression guards against.
    for (let i = 2; i <= MAX_LAST_GOOD_FLOWS_KEYS + 5; i++) {
      fetchRecentFlowsImpl = async () => [
        { alerted_at: "2026-01-01T00:00:00Z", ticker: "SPY", strike: i },
      ];
      // eslint-disable-next-line no-await-in-loop
      await readFlowsMemberCached({ pageLimit: 10, min_premium: i });
    }

    // Now replay the FIRST query's own cache key cold (fallback branch) — before the fix this
    // always came back with its own prior-good rows (count: 1) because nothing ever evicted it;
    // after the fix, once the map has been bounded, an old entry must eventually be reclaimed
    // rather than the map growing by one permanent entry per distinct filter value forever.
    withServerCacheImpl = (_key, _ttl, _loader, opts) => opts.fallback();
    const replay = await readFlowsMemberCached({ pageLimit: 10, min_premium: firstPremium });
    assert.equal(
      replay.count,
      0,
      "an old distinct-filter entry must eventually be evicted, not retained forever unbounded"
    );
    assert.equal(replay.degraded, true);
  });
});
