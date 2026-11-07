import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { todayEt } from "./et-date";

// Controllable per-ticker `aggregateOptionTradesToStrikeRows` output for the
// skipped_ws over-claim regression below — declared ahead of the mock.module() call that
// closes over it (the closure only runs lazily, at test-call time, so textual placement
// relative to the mock.module() registration doesn't matter, only relative to first use).
const optionTradesAgg: Record<string, unknown[]> = { SPX: [], SPY: [] };

// Relative specifiers (not the "@/..." alias) when mocking — tsx's alias rewrite only applies
// to statically-parsed top-level `import ... from` statements, not to mock.module()'s own
// specifier string. Confirmed convention elsewhere in this repo (flow-gex-enrichment.test.ts).
// The module under test (uw-ws-cache-bridge.ts) lives in src/lib/, same as this test file, so
// "./ws/uw-socket" and "./providers/unusual-whales" below are exactly what its own alias
// imports resolve to relative to its own location.
mock.module("./providers/unusual-whales", {
  namedExports: {
    aggregateFlowPerStrikeRows: (rows: unknown) => rows,
    aggregateOptionTradesToStrikeRows: (_rows: unknown, ticker: string) => optionTradesAgg[ticker] ?? [],
    // Faithful copies of the real unusual-whales.ts implementations (not stubs) — the module
    // under test now imports these two for real reshaping logic, so a stub here would hide the
    // exact bug this file's new tests exist to pin.
    coerceDarkPoolRecentRows: (cached: unknown) => {
      if (Array.isArray(cached)) {
        return cached.filter((row) => Boolean(row && typeof row === "object"));
      }
      if (cached && typeof cached === "object" && Array.isArray((cached as { prints?: unknown }).prints)) {
        const snap = cached as { prints: { ticker?: string; premium: number; side: string; executed_at: string; strike: number }[] };
        return snap.prints.map((p) => ({
          ticker: p.ticker,
          premium: p.premium,
          side: p.side,
          executed_at: p.executed_at,
          price: p.strike,
          strike: p.strike,
        }));
      }
      return null;
    },
    darkPoolBias: (call: number, put: number, total: number) => {
      if (total <= 0) return "neutral";
      if (call + put <= 0) return "neutral";
      if (call >= total * 0.65) return "bullish";
      if (put >= total * 0.65) return "bearish";
      if (Math.abs(call - put) < total * 0.15) return "mixed";
      return call > put ? "bullish" : "bearish";
    },
  },
});

// Minimal fake Redis-backed cache: a plain Map keyed by the exact string UW_KEYS.*() builds,
// written only via the test's own `fakeCache` and read by the module under test's `uwCacheRead`.
const fakeCache = new Map<string, unknown>();

mock.module("./providers/uw-shared-cache", {
  namedExports: {
    UW_CACHE_TTL: { darkPoolTicker: 120, darkPoolRecent: 120, marketTide: 180, netPremTicks: 60, flowPerStrike: 120 },
    UW_KEYS: {
      marketTide: () => "market_tide",
      darkPoolTicker: (ticker: string) => `dark_pool:${ticker}`,
      darkPoolRecent: () => "dark_pool_recent",
      netPremTicks: (ticker: string) => `net_prem_ticks:${ticker}`,
      flowPerStrike: (ticker: string) => `flow_per_strike:${ticker}`,
    },
    uwCacheRead: async (key: string) => (fakeCache.has(key) ? fakeCache.get(key) : null),
    uwCacheSet: async () => { /* no-op — other tests in this file always pass redis=null anyway */ },
    getUwCacheRedis: async () => null,
  },
});

type WsFreshState = { offLit: boolean; netFlow: boolean; optionTrades: boolean };
const fresh: WsFreshState = { offLit: false, netFlow: false, optionTrades: false };

// Controllable per-ticker `getNetPremTicksForTicker` output for the skipped_ws
// over-claim regression below — same reasoning as `optionTradesAgg` above.
const netFlowTicks: Record<string, unknown[]> = { SPX: [], SPY: [], QQQ: [], IWM: [] };

mock.module("./ws/uw-socket", {
  namedExports: {
    tideStore: { call_premium: 0, put_premium: 0, net: 0, bias: "neutral", updatedAt: 0 },
    // Recent-ring EMPTY on purpose: this isolates the second, ticker-level off_lit_trades
    // branch (darkPoolStore) from the first (darkPoolRecentRing) — the bug this test pins
    // only shows up when the ring is empty but the ticker-level store still has data.
    darkPoolRecentRing: { rows: [], updatedAt: 0, total_received: 0 },
    darkPoolStore: { data: { prints: [{ ticker: "SPX", premium: 500_000 }] }, updatedAt: Date.now() },
    optionTradesStore: { rows: [], updatedAt: 0, total_received: 0 },
    getNetPremTicksForTicker: (ticker: string) => netFlowTicks[ticker] ?? [],
    isUwChannelFresh: (channel: string) =>
      channel === "off_lit_trades"
        ? fresh.offLit
        : channel === "net_flow"
          ? fresh.netFlow
          : channel === "option_trades"
            ? fresh.optionTrades
            : false,
  },
});

const mod = () => import("./uw-ws-cache-bridge");

test("seedUwCacheFromWsStores counts the ticker-level dark-pool (darkPoolStore) seed", async () => {
  const { seedUwCacheFromWsStores } = await mod();
  fresh.offLit = true;
  // redis=null is a legitimate call shape (see uwCacheSet's own `if (!redis) return` no-op) —
  // this isolates the counting logic from an actual Redis write.
  const result = await seedUwCacheFromWsStores(null as unknown as Parameters<typeof seedUwCacheFromWsStores>[0]);

  // darkPoolRecentRing.rows is empty, so the FIRST off_lit_trades branch never fires — only
  // the SECOND (ticker-level darkPoolStore -> UW_KEYS.darkPoolTicker("SPX")) seeds anything.
  // That write is real (it reaches uwCacheSet) and must be reflected in both return fields.
  assert.equal(result.seeded, 1, "the darkPoolStore(SPX) write must count toward `seeded`");
  assert.deepEqual(
    result.skipped_ws,
    ["off_lit_trades"],
    "off_lit_trades REST should read as WS-covered even when only the ticker-level store seeded"
  );
});

test("seedUwCacheFromWsStores reports nothing seeded when off_lit_trades is stale", async () => {
  const { seedUwCacheFromWsStores } = await mod();
  fresh.offLit = false;
  const result = await seedUwCacheFromWsStores(null as unknown as Parameters<typeof seedUwCacheFromWsStores>[0]);
  assert.equal(result.seeded, 0);
  assert.deepEqual(result.skipped_ws, []);
});

// BUG: net_flow/option_trades over-claimed `skipped_ws` coverage — the mirror image of the
// off_lit_trades undercounting bug the test above and its sibling (lines 85-101) already pin.
// Both blocks gated entry on `isUwChannelFresh(channel, ...)` alone (net_flow) or that plus a
// market-wide `rows.length > 0` check (option_trades), then pushed the channel name onto
// `skipped_ws` UNCONDITIONALLY after their per-ticker loop — even when every ticker in the loop
// produced zero rows and nothing was actually written to Redis. `ws_seeded`/`ws_skipped` on
// GET /api/cron/uw-cache-refresh is exactly the metric the off_lit_trades fix's own comment says
// "ops uses to tell whether the WS bridge is actually covering this channel" — reporting a
// channel as WS-covered while it seeded nothing (e.g. the join just reconnected and the
// per-ticker stores haven't accumulated any ticks yet, or every row belongs to a ticker outside
// the SPX/SPY/QQQ/IWM set this function actually writes) misleads that exact metric the same way
// the already-fixed off_lit_trades bug did, just in the opposite direction (over-claiming
// instead of under-claiming).
test("seedUwCacheFromWsStores does not claim net_flow coverage when the channel is fresh but no ticker produced any ticks", async () => {
  const { seedUwCacheFromWsStores } = await mod();
  fresh.offLit = false;
  fresh.netFlow = true;
  fresh.optionTrades = false;
  netFlowTicks.SPX = [];
  netFlowTicks.SPY = [];
  netFlowTicks.QQQ = [];
  netFlowTicks.IWM = [];

  const result = await seedUwCacheFromWsStores(null as unknown as Parameters<typeof seedUwCacheFromWsStores>[0]);

  assert.equal(result.seeded, 0, "nothing was actually written to Redis");
  assert.deepEqual(
    result.skipped_ws,
    [],
    "net_flow must not be reported WS-covered when zero tickers actually produced ticks"
  );
});

test("seedUwCacheFromWsStores does claim net_flow coverage once at least one ticker produced ticks", async () => {
  const { seedUwCacheFromWsStores } = await mod();
  fresh.offLit = false;
  fresh.netFlow = true;
  fresh.optionTrades = false;
  netFlowTicks.SPX = [{ t: Date.now(), call: 1, put: 1, net: 0 }];
  netFlowTicks.SPY = [];
  netFlowTicks.QQQ = [];
  netFlowTicks.IWM = [];

  const result = await seedUwCacheFromWsStores(null as unknown as Parameters<typeof seedUwCacheFromWsStores>[0]);

  assert.equal(result.seeded, 1);
  assert.deepEqual(result.skipped_ws, ["net_flow"]);
});

test("seedUwCacheFromWsStores does not claim option_trades coverage when the channel is fresh with rows but neither SPX nor SPY aggregated anything", async () => {
  const { seedUwCacheFromWsStores } = await mod();
  const { optionTradesStore } = await import("./ws/uw-socket");
  fresh.offLit = false;
  fresh.netFlow = false;
  fresh.optionTrades = true;
  netFlowTicks.SPX = [];
  netFlowTicks.SPY = [];
  netFlowTicks.QQQ = [];
  netFlowTicks.IWM = [];
  // Market-wide gate passes (some rows exist — e.g. a ticker outside SPX/SPY), but neither
  // per-ticker aggregation this function actually writes produces anything.
  (optionTradesStore as { rows: unknown[]; updatedAt: number }).rows = [{ underlying: "AAPL" }];
  optionTradesAgg.SPX = [];
  optionTradesAgg.SPY = [];

  const result = await seedUwCacheFromWsStores(null as unknown as Parameters<typeof seedUwCacheFromWsStores>[0]);

  assert.equal(result.seeded, 0);
  assert.deepEqual(
    result.skipped_ws,
    [],
    "option_trades must not be reported WS-covered when neither SPX nor SPY actually aggregated any rows"
  );
});

test("seedUwCacheFromWsStores does claim option_trades coverage once a ticker actually aggregates rows", async () => {
  const { seedUwCacheFromWsStores } = await mod();
  const { optionTradesStore } = await import("./ws/uw-socket");
  fresh.offLit = false;
  fresh.netFlow = false;
  fresh.optionTrades = true;
  netFlowTicks.SPX = [];
  netFlowTicks.SPY = [];
  netFlowTicks.QQQ = [];
  netFlowTicks.IWM = [];
  (optionTradesStore as { rows: unknown[]; updatedAt: number }).rows = [{ underlying: "SPX" }];
  optionTradesAgg.SPX = [{ strike: 6000 }];
  optionTradesAgg.SPY = [];

  const result = await seedUwCacheFromWsStores(null as unknown as Parameters<typeof seedUwCacheFromWsStores>[0]);

  assert.equal(result.seeded, 1);
  assert.deepEqual(result.skipped_ws, ["option_trades"]);
});

// BUG FIX: shouldSkipUwCacheRefreshTask("dark_pool_ticker","SPX") used to reuse the ring-based
// darkPoolWsFresh() check (same one "dark_pool_recent" uses) — but the actual Redis key it
// gates, UW_KEYS.darkPoolTicker("SPX"), is written from `darkPoolStore`, a DIFFERENT store fed
// by a DIFFERENT parse of the same off_lit_trades payload (`normalizeDarkPoolWsPayload`, which
// drops premium<=0 / stale-date rows that `extractDarkPoolRawRows` happily lets into the ring).
// So a payload that keeps the ring "fresh" while leaving `darkPoolStore` stale used to make the
// cron SKIP the REST refresh for dark_pool_ticker:SPX on a signal that says nothing about the
// data that key actually holds — silently freezing it with neither WS nor REST ever refreshing
// it. This test pins the ring-fresh/store-stale divergence directly.
test("shouldSkipUwCacheRefreshTask('dark_pool_ticker','SPX') does not skip REST when the ring is fresh but the ticker-level store is stale", async () => {
  const { shouldSkipUwCacheRefreshTask } = await mod();
  const { darkPoolRecentRing, darkPoolStore } = await import("./ws/uw-socket");
  fresh.offLit = true;

  // The market-wide ring IS fresh (e.g. other tickers kept trading off-lit)...
  (darkPoolRecentRing as { rows: unknown[]; updatedAt: number }).rows = [{ ticker: "AAPL", premium: 10 }];
  (darkPoolRecentRing as { rows: unknown[]; updatedAt: number }).updatedAt = Date.now();

  // ...but the SPX ticker-level store (what darkPoolTicker("SPX") is actually built from) has
  // gone stale — e.g. every off_lit_trades row since has had premium<=0 or a prior-session date,
  // so normalizeDarkPoolWsPayload kept returning null and darkPoolStore was never updated again.
  (darkPoolStore as { data: unknown; updatedAt: number }).data = null;
  (darkPoolStore as { data: unknown; updatedAt: number }).updatedAt = 0;

  assert.equal(
    shouldSkipUwCacheRefreshTask("dark_pool_ticker", "SPX"),
    false,
    "the ring being fresh must not excuse skipping REST for a ticker-level key the ring never feeds"
  );
});

test("shouldSkipUwCacheRefreshTask('dark_pool_ticker','SPX') does skip REST once the ticker-level store itself is fresh", async () => {
  const { shouldSkipUwCacheRefreshTask } = await mod();
  const { darkPoolStore } = await import("./ws/uw-socket");
  fresh.offLit = true;

  (darkPoolStore as { data: unknown; updatedAt: number }).data = { prints: [{ ticker: "SPX", premium: 500_000 }] };
  (darkPoolStore as { data: unknown; updatedAt: number }).updatedAt = Date.now();

  assert.equal(shouldSkipUwCacheRefreshTask("dark_pool_ticker", "SPX"), true);
});

// BUG FIX (round 329): `dark_pool_recent` is documented and written EVERYWHERE in this codebase
// (coerceDarkPoolRecentRows's own header; this file's own seedUwCacheFromWsStores above, which
// writes `darkPoolRecentRing.rows` — a raw array) to hold raw UW rows, never a DarkPoolSnapshot
// object. `darkPoolSnapshotFromRecentRows` is the reshaper that makes the cached value usable;
// pinned directly since it is new, pure, and the entire fix.
test("darkPoolSnapshotFromRecentRows reshapes raw UW rows into a real DarkPoolSnapshot", async () => {
  const { darkPoolSnapshotFromRecentRows } = await mod();
  const today = "2026-11-01";

  const snap = darkPoolSnapshotFromRecentRows(
    [
      // Today, call, counts.
      { ticker: "AAPL", premium: 600_000, strike: 231, type: "call", side: "above_mid", executed_at: `${today}T14:31:00.000Z` },
      // Today, put, counts.
      { ticker: "MSFT", premium: 400_000, strike: 410, type: "put", side: "below_mid", executed_at: `${today}T15:02:00.000Z` },
      // Prior session — must be dropped (stale row surviving a cold TTL boundary).
      { ticker: "TSLA", premium: 900_000, strike: 250, type: "call", executed_at: "2026-10-31T14:00:00.000Z" },
      // Zero premium — must be dropped (never a real print).
      { ticker: "NVDA", premium: 0, strike: 900, type: "call", executed_at: `${today}T13:00:00.000Z` },
    ],
    today
  );

  assert.notEqual(snap, null, "two valid today-dated rows must produce a real snapshot, not null");
  assert.equal(snap!.prints.length, 2, "only the two today-dated, positive-premium rows survive");
  assert.equal(snap!.total_premium, 1_000_000);
  assert.equal(snap!.call_premium, 600_000);
  assert.equal(snap!.put_premium, 400_000);
  // call=600k < total*0.65=650k, put=400k < 650k, |600k-400k|=200k is NOT < total*0.15=150k,
  // so darkPoolBias falls through to its final call>put branch.
  assert.equal(snap!.bias, "bullish");
});

test("darkPoolSnapshotFromRecentRows returns null when nothing survives the today/premium filter", async () => {
  const { darkPoolSnapshotFromRecentRows } = await mod();
  const snap = darkPoolSnapshotFromRecentRows(
    [{ ticker: "SPY", premium: 100, strike: 500, executed_at: "2020-01-01T14:00:00.000Z" }],
    "2026-11-01"
  );
  assert.equal(snap, null);
});

// THE REGRESSION ITSELF: readUwDarkPoolFromRedis's market-wide fallback used to cast the raw
// `dark_pool_recent` array straight to DarkPoolSnapshot with no reshaping. Any caller's own
// freshness guard (`redisDp?.prints?.length`, e.g. spx-desk.ts's resolveDarkPool) always read
// `undefined` on a bare array, so the fallback silently never activated. Before this fix, this
// test fails: `prints` is `undefined` on the raw-array return, not an array of length 1.
test("readUwDarkPoolFromRedis falls back to a reshaped market-wide snapshot when the ticker key is empty", async () => {
  const { readUwDarkPoolFromRedis } = await mod();
  fakeCache.clear();
  // Ticker-specific key absent/empty (e.g. SPX has no equity dark-pool prints of its own).
  fakeCache.delete("dark_pool:SPX");
  // dark_pool_recent holds exactly what it always holds in production: a raw array of UW rows.
  // Use the ET session date (not UTC) — darkPoolSnapshotFromRecentRows defaults its own `today`
  // filter to todayEt(), and the two disagree for several hours every day (UTC rolls over to the
  // next calendar day while it's still "today" in New York), which silently broke this test.
  const today = todayEt();
  fakeCache.set("dark_pool_recent", [
    { ticker: "AAPL", premium: 750_000, strike: 231, type: "call", executed_at: `${today}T14:31:00.000Z` },
  ]);

  const result = await readUwDarkPoolFromRedis("SPX");
  assert.notEqual(result, null, "a fresh market-wide cache entry must not be discarded as empty");
  assert.equal(result?.prints?.length, 1, "the raw cached row must reach callers as a real print, not a hollow object");
  assert.equal(result?.total_premium, 750_000);
});
