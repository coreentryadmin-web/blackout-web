import assert from "node:assert/strict";
import { test, mock } from "node:test";

// Regression for a production incident (2026-09-03): the homepage (`revalidate = 3600` ISR) seeded
// its gamma panel with `buildPublicGexSnapshot`, which live-computes on a cache miss via
// `fetchGexHeatmap` → ... → `polygonFetchUrl`'s `fetch(..., { cache: "no-store" })`. Firing that
// no-store fetch from a page Next.js is still trying to render STATICALLY trips Next's
// "Dynamic server usage" bailout (`DynamicServerError`), which `polygonFetchUrl`'s broad `catch`
// swallows exactly like a real network failure — logged live as "[polygon-gex] chain fetch threw
// ... Dynamic server usage: Route / couldn't be rendered statically ...", recurring dozens of
// times a day in CloudWatch, always on "Route /" (the homepage, never `/tools/gamma-snapshot` or
// the API route, both already fully dynamic). That swallowed error cascades into a
// "no options-chain data" empty snapshot, which `buildPublicGexSnapshot` then WRITES to the
// shared 5s Redis cache — poisoning it for every other reader (the client's own live poll
// included) until the next successful compute.
//
// `readPublicGexSnapshotSeed` is the fix: a cache-only read for ISR pages that never calls
// `fetchGexHeatmap`, so it can never trip the bailout or corrupt the shared cache. These tests
// prove that contract directly against a spy on `fetchGexHeatmap`.

const state = {
  cache: new Map<string, unknown>(),
  fetchCalls: 0,
};

mock.module("./shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) => (state.cache.has(key) ? state.cache.get(key) : null),
    sharedCacheSet: async (key: string, value: unknown) => {
      state.cache.set(key, value);
    },
    sharedCacheDel: async (key: string) => {
      state.cache.delete(key);
    },
  },
});

mock.module("./providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async () => {
      state.fetchCalls += 1;
      throw new Error("live compute must never be attempted by the seed reader");
    },
  },
});

const mod = () => import("./public-gex-snapshot.ts");

// Exercised separately for all three public tickers (SPX, SPY, QQQ) — the homepage only ever
// seeds SPX today, but the bug this guards against (a live-compute call from an ISR page) is a
// property of readPublicGexSnapshotSeed itself, not of any one ticker, and the three tickers use
// distinct cache keys (`public-gex-snapshot:<ticker>`), so a regression scoped to one ticker's key
// derivation would not be caught by testing SPX alone.
const TICKERS = ["SPX", "SPY", "QQQ"] as const;
const SAMPLE_SPOT: Record<(typeof TICKERS)[number], number> = { SPX: 5500, SPY: 550, QQQ: 460 };
const LAST_GOOD_SPOT: Record<(typeof TICKERS)[number], number> = { SPX: 5480, SPY: 548, QQQ: 458 };

for (const ticker of TICKERS) {
  test(`readPublicGexSnapshotSeed never calls fetchGexHeatmap — cache hit (${ticker})`, async () => {
    const { readPublicGexSnapshotSeed } = await mod();
    state.cache.clear();
    state.fetchCalls = 0;
    state.cache.set(`public-gex-snapshot:${ticker}`, {
      available: true,
      ticker,
      spot: SAMPLE_SPOT[ticker],
      change_pct: 0.5,
      asof: "2026-09-03T00:00:00.000Z",
      market_session: "OPEN",
      session_date: "2026-09-02",
      as_of_et: "2026-09-02 20:00 ET",
      call_wall: SAMPLE_SPOT[ticker] * 1.02,
      put_wall: SAMPLE_SPOT[ticker] * 0.98,
      flip: SAMPLE_SPOT[ticker] * 0.996,
      posture: "long",
      call_wall_role: "resistance",
      put_wall_role: "support",
      read: "Long gamma regime.",
      degraded: false,
      degraded_note: null,
    });

    const seed = await readPublicGexSnapshotSeed(ticker);
    assert.equal(seed.available, true);
    assert.equal(seed.spot, SAMPLE_SPOT[ticker]);
    assert.equal(state.fetchCalls, 0, "a hot cache read must never touch the live compute path");
  });

  test(`readPublicGexSnapshotSeed falls back to last-known-good without ever computing live (${ticker})`, async () => {
    const { readPublicGexSnapshotSeed } = await mod();
    state.cache.clear();
    state.fetchCalls = 0;
    state.cache.set(`public-gex-snapshot:last-good:${ticker}`, {
      available: true,
      ticker,
      spot: LAST_GOOD_SPOT[ticker],
      change_pct: -0.1,
      asof: "2026-09-02T23:55:00.000Z",
      market_session: "CLOSED",
      session_date: "2026-09-02",
      as_of_et: "2026-09-02 23:55 ET",
      call_wall: LAST_GOOD_SPOT[ticker] * 1.01,
      put_wall: LAST_GOOD_SPOT[ticker] * 0.99,
      flip: LAST_GOOD_SPOT[ticker] * 0.996,
      posture: "short",
      call_wall_role: "resistance",
      put_wall_role: "support",
      read: "Short gamma regime.",
      degraded: false,
      degraded_note: null,
    });

    const seed = await readPublicGexSnapshotSeed(ticker);
    assert.equal(seed.available, true);
    assert.equal(seed.degraded, true);
    assert.equal(seed.spot, LAST_GOOD_SPOT[ticker]);
    assert.equal(state.fetchCalls, 0, "a last-known-good fallback must never touch the live compute path");
  });

  test(`readPublicGexSnapshotSeed returns a warming placeholder when there is nothing cached at all (${ticker})`, async () => {
    const { readPublicGexSnapshotSeed } = await mod();
    state.cache.clear();
    state.fetchCalls = 0;

    const seed = await readPublicGexSnapshotSeed(ticker);
    assert.equal(seed.available, false);
    assert.equal(seed.spot, null);
    assert.equal(state.fetchCalls, 0, "no cache at all must still never touch the live compute path");
  });
}
