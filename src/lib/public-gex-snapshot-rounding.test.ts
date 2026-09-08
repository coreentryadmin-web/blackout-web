import assert from "node:assert/strict";
import { test, mock } from "node:test";

// Regression for BO-P3-GEXSNAP-ROUND (found via the BLACKOUT AUTOPILOT discovery pass,
// 2026-09-03): fetchGexHeatmap's own money-math produces IEEE-754 floats with spurious
// trailing decimal digits (documented in round-floats.ts, e.g. `7499.360000000001` — spot
// is frequently `spy.price * 10`), and every OTHER consumer of the SAME canonical matrix
// (gex-heatmap/route.ts, mobile/ticker, track-record, ...) wraps its response in
// roundFloats() before serving it. This public, unauthenticated endpoint (the
// /tools/gamma-snapshot lead magnet + homepage promo) was the one gap — it passed
// heatmap.spot/change_pct/call_wall/put_wall/flip straight through unrounded.
const state = {
  cache: new Map<string, unknown>(),
  heatmap: {
    // Deliberately unrounded, matching the documented real-world shape (round-floats.ts's
    // own comment cites `7499.360000000001`).
    spot: 5499.360000000001,
    change_pct: 0.123456789,
    asof: "2026-09-03T20:00:00.000Z",
    gex: {
      call_wall: 5600,
      put_wall: 5400,
      flip: 5480,
      regime: { posture: "long" as const, read: "Long gamma regime." },
    },
  } as const,
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
    fetchGexHeatmap: async () => state.heatmap,
  },
});

test("buildPublicGexSnapshot rounds spot/change_pct to 2dp instead of serving raw IEEE-754 noise", async () => {
  const { buildPublicGexSnapshot } = await import("./public-gex-snapshot.ts");
  state.cache.clear();

  const snapshot = await buildPublicGexSnapshot("SPX");

  assert.equal(snapshot.spot, 5499.36, `expected rounded spot, got ${snapshot.spot}`);
  assert.equal(
    snapshot.change_pct,
    0.12,
    `expected change_pct rounded to 2dp, got ${snapshot.change_pct}`
  );
  // Confirm it isn't just coincidentally clean — the raw fixture value really does have the
  // spurious trailing digits this test guards against.
  assert.notEqual(state.heatmap.spot, snapshot.spot);
});

test("buildPublicGexSnapshot leaves already-clean strike-price walls untouched", async () => {
  const { buildPublicGexSnapshot } = await import("./public-gex-snapshot.ts");
  state.cache.clear();

  const snapshot = await buildPublicGexSnapshot("SPX");

  assert.equal(snapshot.call_wall, 5600);
  assert.equal(snapshot.put_wall, 5400);
  assert.equal(snapshot.flip, 5480);
});
