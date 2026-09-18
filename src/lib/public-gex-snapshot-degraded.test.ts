import assert from "node:assert/strict";
import { test, mock } from "node:test";

// asof/calculated_at/spot_timestamp/chain_timestamp are computed relative to the real
// wall clock (not a fixed past date) — buildPublicGexSnapshot's `degraded` flag now depends on
// genuine elapsed age (public-gex-snapshot.ts's STALE_DEGRADED_SEC), so a "live read" fixture
// must actually be live-fresh to correctly exercise `degraded === false`, not a date that was
// merely "recent" the day this fixture was written and grows staler with every calendar day.
const NOW_ISO = new Date().toISOString();

const state = {
  cache: new Map<string, unknown>(),
  heatmap: {
    spot: 5500,
    change_pct: 0.5,
    asof: NOW_ISO,
    spot_source: "rest" as const,
    calculation_id: "SPX:1756756800000",
    calculated_at: NOW_ISO,
    spot_timestamp: NOW_ISO,
    chain_timestamp: NOW_ISO,
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
  assert.equal(live.calculated_at, NOW_ISO);
  assert.equal(live.spot_timestamp, NOW_ISO);
  assert.equal(live.chain_timestamp, NOW_ISO);
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

// Regression for a real production incident (2026-09-11, RTH): the underlying matrix's own
// never-block stale-handoff (pickStaleHeatmapForHandoff, polygon-options-gex.ts) served the SAME
// calculation_id for 4+ minutes while a background rebuild silently kept failing — and this
// endpoint's `degraded` flag stayed `false` the entire time, because buildSnapshotFromHeatmap
// hardcodes `degraded: false` on ANY non-null heatmap regardless of how stale it turned out to
// be. A cache hit takes the same `withAgeFields` path as a fresh compute, so a snapshot written
// long enough ago must flip `degraded: true` on READ, not just at write time.
test("buildPublicGexSnapshot marks a snapshot degraded once it is older than the stale bound, even though the heatmap fetch itself succeeded", async () => {
  const { buildPublicGexSnapshot } = await mod();
  state.cache.clear();
  state.failLive = false;

  const staleAsof = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min old
  state.cache.set("public-gex-snapshot:SPX", {
    available: true,
    ticker: "SPX",
    spot: 5500,
    change_pct: 0.5,
    asof: staleAsof,
    market_session: "OPEN",
    session_date: "2026-09-11",
    as_of_et: "2026-09-11 11:34 ET",
    call_wall: 5600,
    put_wall: 5400,
    flip: 5480,
    posture: "long",
    call_wall_role: "resistance",
    put_wall_role: "support",
    read: "Long gamma regime.",
    calculation_id: "SPX:stale-calc-id",
    degraded: false,
    degraded_note: null,
  });

  const snapshot = await buildPublicGexSnapshot("SPX");
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.degraded, true, "a 5-minute-old cached snapshot must not read as fresh");
  assert.ok(snapshot.degraded_note);
  assert.match(snapshot.degraded_note ?? "", /stalled/i);
  assert.equal(snapshot.calculation_id, "SPX:stale-calc-id", "the frozen envelope is still served, just flagged");
});

test("buildPublicGexSnapshot does not flag a genuinely fresh snapshot as degraded", async () => {
  const { buildPublicGexSnapshot } = await mod();
  state.cache.clear();
  state.failLive = false;

  const live = await buildPublicGexSnapshot("SPX");
  assert.equal(live.degraded, false);
  assert.equal(live.degraded_note, null);
});
