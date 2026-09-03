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

test("readPublicGexSnapshotSeed never calls fetchGexHeatmap — cache hit", async () => {
  const { readPublicGexSnapshotSeed } = await mod();
  state.cache.clear();
  state.fetchCalls = 0;
  state.cache.set("public-gex-snapshot:SPX", {
    available: true,
    ticker: "SPX",
    spot: 5500,
    change_pct: 0.5,
    asof: "2026-09-03T00:00:00.000Z",
    market_session: "OPEN",
    session_date: "2026-09-02",
    as_of_et: "2026-09-02 20:00 ET",
    call_wall: 5600,
    put_wall: 5400,
    flip: 5480,
    posture: "long",
    call_wall_role: "resistance",
    put_wall_role: "support",
    read: "Long gamma regime.",
    degraded: false,
    degraded_note: null,
  });

  const seed = await readPublicGexSnapshotSeed("SPX");
  assert.equal(seed.available, true);
  assert.equal(seed.spot, 5500);
  assert.equal(state.fetchCalls, 0, "a hot cache read must never touch the live compute path");
});

test("readPublicGexSnapshotSeed falls back to last-known-good without ever computing live", async () => {
  const { readPublicGexSnapshotSeed } = await mod();
  state.cache.clear();
  state.fetchCalls = 0;
  state.cache.set("public-gex-snapshot:last-good:SPX", {
    available: true,
    ticker: "SPX",
    spot: 5480,
    change_pct: -0.1,
    asof: "2026-09-02T23:55:00.000Z",
    market_session: "CLOSED",
    session_date: "2026-09-02",
    as_of_et: "2026-09-02 23:55 ET",
    call_wall: 5550,
    put_wall: 5400,
    flip: 5460,
    posture: "short",
    call_wall_role: "resistance",
    put_wall_role: "support",
    read: "Short gamma regime.",
    degraded: false,
    degraded_note: null,
  });

  const seed = await readPublicGexSnapshotSeed("SPX");
  assert.equal(seed.available, true);
  assert.equal(seed.degraded, true);
  assert.equal(seed.spot, 5480);
  assert.equal(state.fetchCalls, 0, "a last-known-good fallback must never touch the live compute path");
});

test("readPublicGexSnapshotSeed returns a warming placeholder when there is nothing cached at all", async () => {
  const { readPublicGexSnapshotSeed } = await mod();
  state.cache.clear();
  state.fetchCalls = 0;

  const seed = await readPublicGexSnapshotSeed("SPX");
  assert.equal(seed.available, false);
  assert.equal(seed.spot, null);
  assert.equal(state.fetchCalls, 0, "no cache at all must still never touch the live compute path");
});
