import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Relative specifiers (not the "@/..." alias) when mocking — tsx's alias rewrite only applies
// to statically-parsed top-level `import ... from` statements, not to mock.module()'s own
// specifier string. Confirmed convention elsewhere in this repo (flow-gex-enrichment.test.ts).
// The module under test (uw-ws-cache-bridge.ts) lives in src/lib/, same as this test file, so
// "./ws/uw-socket" and "./providers/unusual-whales" below are exactly what its own alias
// imports resolve to relative to its own location.
mock.module("./providers/unusual-whales", {
  namedExports: {
    aggregateFlowPerStrikeRows: (rows: unknown) => rows,
    aggregateOptionTradesToStrikeRows: () => [],
  },
});

type WsFreshState = { offLit: boolean };
const fresh: WsFreshState = { offLit: false };

mock.module("./ws/uw-socket", {
  namedExports: {
    tideStore: { call_premium: 0, put_premium: 0, net: 0, bias: "neutral", updatedAt: 0 },
    // Recent-ring EMPTY on purpose: this isolates the second, ticker-level off_lit_trades
    // branch (darkPoolStore) from the first (darkPoolRecentRing) — the bug this test pins
    // only shows up when the ring is empty but the ticker-level store still has data.
    darkPoolRecentRing: { rows: [], updatedAt: 0, total_received: 0 },
    darkPoolStore: { data: { prints: [{ ticker: "SPX", premium: 500_000 }] }, updatedAt: Date.now() },
    optionTradesStore: { rows: [], updatedAt: 0, total_received: 0 },
    getNetPremTicksForTicker: () => [],
    isUwChannelFresh: (channel: string) => (channel === "off_lit_trades" ? fresh.offLit : false),
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
