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
      regime: {
        posture: "short" as const,
        read: "Spot 5,500 is below the gamma flip (5,480) → short gamma: momentum / vol expansion, moves accelerate. Resistance 5,600, support 5,400.",
      },
    },
  } as const,
  failLive: false,
  marketSession: "OPEN" as "OPEN" | "PRE-MARKET" | "AFTER-HOURS" | "CLOSED",
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

// So the degraded-from-last-good tests below can move the clock to a different session than the
// one the live snapshot was built under, deterministically rather than depending on the real
// wall-clock time the suite happens to run at.
mock.module("./et-session-facts", {
  namedExports: {
    etSessionFacts: () => ({
      market_session: state.marketSession,
      session_date: "2026-09-01",
      et_time: "12:00 ET",
      as_of_et: `2026-09-01 12:00 ET`,
      is_trading_day: true,
    }),
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

// Regression: a last-good snapshot can be re-served across a session boundary it was never
// computed for (that is the explicit point of the 24h LAST_GOOD_TTL_SEC cache). Before this fix,
// `degradedFromLastGood` overrode `market_session` to whatever session is in effect NOW but left
// the carried-over `read` untouched — so a read built while OPEN (an actionable, un-gated "momentum
// / vol expansion, moves accelerate" claim) kept asserting live momentum even while `market_session`
// correctly reported CLOSED. That is exactly the contradiction `applyPublicReadFreshnessGate` exists
// to prevent for a live compute; the degraded/last-good fallback path bypassed it entirely.
test("buildPublicGexSnapshot re-gates the carried-over regime read when a last-good snapshot crosses a session boundary", async () => {
  const { buildPublicGexSnapshot } = await mod();
  state.cache.clear();
  state.failLive = false;
  state.marketSession = "OPEN";

  const live = await buildPublicGexSnapshot("SPX");
  assert.equal(live.degraded, false);
  assert.match(live.read, /moves accelerate/i, "sanity: the live OPEN read is the actionable claim");

  // Market closes; live upstream also goes down, forcing the last-good fallback path.
  state.marketSession = "CLOSED";
  state.failLive = true;
  state.cache.delete("public-gex-snapshot:SPX");

  const degraded = await buildPublicGexSnapshot("SPX");
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.market_session, "CLOSED");
  assert.ok(
    !/moves accelerate/i.test(degraded.read),
    `degraded read must not keep asserting live momentum once market_session is CLOSED: ${degraded.read}`
  );
  assert.match(degraded.read, /^Prior-session structural reference/, degraded.read);
});

test("buildPublicGexSnapshot returns warming only when no last-good exists", async () => {
  const { buildPublicGexSnapshot } = await mod();
  state.cache.clear();
  state.failLive = true;
  state.marketSession = "OPEN";

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
  state.marketSession = "OPEN";

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
