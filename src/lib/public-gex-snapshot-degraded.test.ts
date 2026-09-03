import assert from "node:assert/strict";
import { test, mock } from "node:test";

const state = {
  cache: new Map<string, unknown>(),
  heatmap: {
    spot: 5500,
    change_pct: 0.5,
    asof: "2026-09-01T20:00:00.000Z",
    spot_source: "rest" as const,
    calculation_id: "SPX:1756756800000",
    calculated_at: "2026-09-01T20:00:00.000Z",
    spot_timestamp: "2026-09-01T19:59:59.500Z",
    chain_timestamp: "2026-09-01T19:59:59.800Z",
    expires_at: "2026-09-01T20:00:05.000Z",
    gex: {
      call_wall: 5600,
      put_wall: 5400,
      flip: 5480,
      regime: { posture: "long" as const, read: "Long gamma regime." },
    },
  } as const,
  failLive: false,
};

mock.module("./shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) =>
      state.cache.has(key) ? state.cache.get(key) : null,
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
    fetchGexHeatmap: async () => (state.failLive ? null : state.heatmap),
  },
});

const mod = () => import("./public-gex-snapshot.ts");

// Cross-product compute identity (2026-09-03) — the free public snapshot is one of the two
// payloads the operator explicitly named as needing to prove sameness with SPX Slayer's paid
// matrix. buildSnapshotFromHeatmap must pass the envelope through verbatim on a live read.
test("buildPublicGexSnapshot passes the calculation-envelope fields through on a live read", async () => {
  const { buildPublicGexSnapshot } = await mod();
  state.cache.clear();
  state.failLive = false;

  const live = await buildPublicGexSnapshot("SPX");
  assert.equal(live.calculation_id, "SPX:1756756800000");
  assert.equal(live.calculated_at, "2026-09-01T20:00:00.000Z");
  assert.equal(live.spot_timestamp, "2026-09-01T19:59:59.500Z");
  assert.equal(live.chain_timestamp, "2026-09-01T19:59:59.800Z");
  assert.equal(live.expires_at, "2026-09-01T20:00:05.000Z");
});

test("buildPublicGexSnapshot serves last-good with degraded badge when live fetch returns null", async () => {
  const { buildPublicGexSnapshot } = await mod();
  state.cache.clear();
  state.failLive = false;

  const live = await buildPublicGexSnapshot("SPX");
  assert.equal(live.available, true);
  assert.equal(live.spot, 5500);
  assert.equal(live.degraded, false);

  state.failLive = true;
  state.cache.delete("public-gex-snapshot:SPX");

  const degraded = await buildPublicGexSnapshot("SPX");
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.available, true);
  assert.equal(degraded.spot, 5500);
  assert.ok(degraded.degraded_note);
});

test("buildPublicGexSnapshot returns warming only when no last-good exists", async () => {
  const { buildPublicGexSnapshot } = await mod();
  state.cache.clear();
  state.failLive = true;

  const empty = await buildPublicGexSnapshot("SPY");
  assert.equal(empty.available, false);
  assert.equal(empty.warming_reason, "warming");
  assert.equal(empty.spot, null);
});
