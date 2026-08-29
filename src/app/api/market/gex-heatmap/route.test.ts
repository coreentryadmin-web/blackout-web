import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { GexHeatmap } from "../../../../lib/providers/polygon-options-gex";

// Regression (docs/audit/FINDINGS.md, P1, 2026-07-05): fetchGexHeatmap's emptyHeatmap()
// fallback (polygon-options-gex.ts ~2422) returns a REAL GexHeatmap object — never null —
// whenever spot resolution fails and/or the options chain comes back with zero contracts.
// That object has spot:0, strikes:[], and a "No options-chain data…" regime read. The route's
// `if (!heatmap)` guard only catches the null case, so the unconditional `available: true`
// a few lines below it was stamping "usable" on that empty object too — confirmed live for
// SPY/QQQ as `{ available: true, spot: 0, strikes: [] }`. The fix computes `available` from
// the object's own contents (spot > 0 AND strikes.length > 0) instead of hardcoding true.
//
// mock.module() resolves bare specifiers relative to THIS file (not the "@/" tsconfig alias)
// — see src/app/api/market/quote/route.test.ts for the same pattern. Every module route.ts
// imports directly is mocked here: some (gex-cross-validation, tool-access-server) use
// `import "server-only"`, which throws under plain Node outside a Next.js server bundle, so
// they MUST be intercepted before route.ts's static imports ever touch the real files.

let mockHeatmap: GexHeatmap | null = null;
let fetchGexHeatmapCalls = 0;
let capturedLaunchTools: string[] | null = null;
// Task #174 fixture: defaults to "market open" so every PRE-EXISTING test above keeps its
// original behavior untouched (the off-hours gate is a no-op when isEtCashRth() is true).
let mockMarketOpen = true;

mock.module("server-only", { namedExports: {} });
mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    authorizeMarketDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});
mock.module("../../../../lib/tool-access-server", {
  namedExports: {
    requireAnyToolApi: async (tools: string[]) => {
      capturedLaunchTools = tools;
      return null; // tool launched — never gate the test
    },
  },
});
mock.module("../../../../lib/providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async () => {
      fetchGexHeatmapCalls++;
      return mockHeatmap;
    },
    peekGexHeatmapCache: async () => ({
      ticker: "SPY",
      cached: false,
      last_compute_at: null,
      age_sec: null,
      ttl_sec: 5,
      stale: true,
      spot: null,
      events_count: null,
    }),
    readGexHeatmapSnapshot: async () => mockHeatmap,
  },
});
mock.module("../../../../lib/providers/gex-cross-validation", {
  namedExports: {
    validateGexAgainstUW: async () => null,
  },
});
mock.module("../../../../lib/providers/unusual-whales", {
  namedExports: {
    fetchUwFlowPerStrikeRows: async () => [],
    fetchUwDarkPool: async () => null,
  },
});
mock.module("../../../../lib/providers/uw-rate-limiter", {
  namedExports: {
    isUwCircuitOpen: () => false,
  },
});
mock.module("../../../../lib/shared-cache", {
  namedExports: {
    sharedCacheGet: async () => null,
    sharedCacheSet: async () => {},
  },
});
mock.module("../../../../lib/db", {
  namedExports: {
    dbConfigured: () => false,
    fetchLatestNighthawkEdition: async () => null,
    fetchLatestPlayableNighthawkEdition: async () => null,
  },
});
mock.module("../../../../lib/et-market-hours", {
  namedExports: {
    isEtCashRth: () => mockMarketOpen,
  },
});
mock.module("../../../../features/vector/lib/vector-universe", {
  namedExports: {
    registerVectorUniverseView: () => {},
  },
});

/** Captures the expiry allow-list passed to getGexStrikeExpiryLadder (Thermal wall override). */
let lastWsLadderAllowList: readonly string[] | undefined = undefined;
let mockWsLive = false;
let mockWsLadder: {
  ladder: Map<number, number>;
  updatedAt: number;
} | null = null;

mock.module("../../../../lib/ws/uw-socket", {
  namedExports: {
    joinGexStrikeExpiryTicker: () => {},
    hasLiveGexStrikeExpiry: () => mockWsLive,
    getGexStrikeExpiryLadder: (_ticker: string, allowedExpiries?: readonly string[]) => {
      lastWsLadderAllowList = allowedExpiries;
      return mockWsLadder;
    },
  },
});
// heatmap-allowlist is intentionally left real (its own header notes it's a pure data +
// predicate module, safe outside a server bundle) — "ZZZZ" below is neither a preset nor an
// overlay-allowlisted ticker, so cross_validation/overlays stay on their skip paths for free.

/** A fully-populated, non-empty heatmap — the normal "real data" case. */
function liveHeatmap(overrides: Partial<GexHeatmap> = {}): GexHeatmap {
  return {
    underlying: "ZZZZ",
    spot: 100,
    change_pct: 1.2,
    asof: "2026-07-05T14:30:00.000Z",
    expiries: ["2026-07-10"],
    strikes: [95, 100, 105],
    max_pain: 100,
    gex: {
      cells: { "100": { "2026-07-10": 20 } },
      strike_totals: { "95": 10, "100": 20, "105": -5 },
      call_wall: 100,
      put_wall: 105,
      total: 25,
      flip: 98,
      regime: { flip: 98, posture: "long", read: "Dealers long gamma above 98." },
    },
    vex: {
      cells: {},
      strike_totals: {},
      pos_wall: null,
      neg_wall: null,
      total: 0,
      flip: null,
      regime: { posture: null, read: "No qualifying vanna data." },
    },
    shift: { available: false, status: "collecting" },
    near_term_expiries: ["2026-07-10"],
    source: "polygon",
    data_delay: "15-min delayed",
    ...overrides,
  };
}

/**
 * A REAL computed shift/vex_shift payload (task #174 fixture) — mirrors the exact live-observed
 * shape from the audit: a present-tense summary + real deltas, as produced by computeMetricShift
 * once ≥2 positioning-history snapshots exist. Used to prove the off-hours gate overrides
 * `available` regardless of what the underlying (correctly-computed) cached object holds.
 */
function realShift(overrides: Partial<GexHeatmap["shift"]> = {}): GexHeatmap["shift"] {
  return {
    available: true,
    delta_by_strike: { "100": 5000, "105": -1200 },
    flip_migration: { from: 96, to: 98, delta_pts: 2 },
    wall_changes: {
      call_wall: { from: 98, to: 100, moved_pts: 2, grew_pct: 12.5 },
      put_wall: { from: 106, to: 105, moved_pts: -1, grew_pct: null },
    },
    summary: "Over the last 2h14m: the 100 call wall built +12.5%, gamma flip migrated up 2 pts (dealers building).",
    since_ms: 8_040_000,
    baseline_ts: 1_751_000_000_000,
    ...overrides,
  };
}

/** fetchGexHeatmap's emptyHeatmap() fallback shape — spot never resolved, chain empty. */
function unusableHeatmap(overrides: Partial<GexHeatmap> = {}): GexHeatmap {
  return liveHeatmap({
    spot: 0,
    change_pct: 0,
    expiries: [],
    strikes: [],
    max_pain: null,
    gex: {
      cells: {},
      strike_totals: {},
      call_wall: null,
      put_wall: null,
      total: 0,
      flip: null,
      regime: {
        flip: null,
        posture: null,
        read: "No options-chain data for this ticker — dealer gamma profile unavailable.",
      },
    },
    ...overrides,
  });
}

describe("/api/market/gex-heatmap available flag", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("M1: launch gate checks spx OR heatmap (not heatmap-only)", async () => {
    mockHeatmap = liveHeatmap();
    capturedLaunchTools = null;
    await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=SPX"));
    assert.deepEqual(capturedLaunchTools, ["spx", "heatmap"]);
  });

  test("a non-null but EMPTY heatmap (spot:0, strikes:[]) now reports available:false — pre-fix this returned true", async () => {
    mockHeatmap = unusableHeatmap();
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    // This is the exact live-observed shape from the audit: available:true next to spot:0
    // and an empty strikes array. Proving the OLD behavior would require reverting the fix;
    // this assertion instead pins the CORRECT contract going forward.
    assert.equal(body.available, false, "an unusable empty heatmap must not report available:true");
    assert.equal(body.spot, 0);
    assert.deepEqual(body.strikes, []);
  });

  test("a resolved spot with a thin/empty chain (spot > 0, strikes:[]) also reports available:false", async () => {
    // The OTHER emptyHeatmap() call site (buildGexHeatmapUncached, 0 contracts on a resolved
    // spot) — still has nothing real to show on the matrix, so it gets the same treatment.
    mockHeatmap = unusableHeatmap({ spot: 452.1, change_pct: 0.4 });
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    assert.equal(body.available, false);
    assert.deepEqual(body.strikes, []);
  });

  test("a real, non-empty heatmap still reports available:true (no regression on the happy path)", async () => {
    mockHeatmap = liveHeatmap();
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    assert.equal(body.available, true);
    assert.equal(body.spot, 100);
    assert.deepEqual(body.strikes, [95, 100, 105]);
    assert.equal(body.gex.call_wall, 100);
  });

  test("a null heatmap (cache miss) short-circuits to available:false and schedules background warm", async () => {
    mockHeatmap = null;
    const callsBefore = fetchGexHeatmapCalls;
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    assert.equal(body.available, false);
    assert.equal(body.underlying, "ZZZZ");
    // Cache miss → fire-and-forget warm via fetchGexHeatmap (not awaited on the request path).
    assert.equal(fetchGexHeatmapCalls, callsBefore + 1);
    assert.equal(body.strikes, undefined);
  });
});

// Task #174 (P1): computeMetricShift's diff has ZERO market-hours awareness — it only runs when
// the matrix cache refreshes, so a cached shift object with a present-tense "Over the last Xh Ym:
// ... migrated..." summary keeps being served UNCHANGED to every user through an entire closed
// period (evenings/weekends/holidays) until the next refresh. Confirmed live: SPX heatmap served
// shift.available:true with a fresh-reading migration summary on a closed market. The fix
// overrides `available` to false on BOTH shift and vex_shift in the route's response whenever
// isEtCashRth() is false RIGHT NOW — regardless of what the cached heatmap object holds — and
// blanks the rest of the object (never fabricated, same shape the cold-start "collecting" path
// already uses) so the misleading summary text never leaves the server while markets are closed.
describe("/api/market/gex-heatmap off-hours shift gate", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("outside RTH, shift.available is forced false even though the cached heatmap has REAL computed shift data", async () => {
    mockMarketOpen = false;
    mockHeatmap = liveHeatmap({ shift: realShift() });
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    assert.equal(body.shift.available, false, "market is closed — a real shift must still be suppressed");
    assert.equal(body.shift.status, "collecting");
    // The whole object is blanked, not just the boolean — the present-tense summary that
    // triggered this bug (audit-quoted: "Over the last 2h14m: gamma flip migrated...") must
    // never leave the server while the market is closed, even as a "hidden" field.
    assert.equal(body.shift.summary, undefined);
    assert.equal(body.shift.flip_migration, undefined);
    assert.equal(body.shift.wall_changes, undefined);
    // Per-strike deltas are preserved for matrix DR% — last-session facts, not live narrative.
    assert.deepEqual(body.shift.delta_by_strike, { "100": 5000, "105": -1200 });
    assert.equal(body.shift.since_ms, 8_040_000);
  });

  test("outside RTH, vex_shift.available is ALSO forced false when it independently carries real data", async () => {
    mockMarketOpen = false;
    mockHeatmap = liveHeatmap({
      shift: realShift(),
      vex_shift: realShift({ summary: "Over the last 2h14m: net dealer vanna melted -8% (dealers thinning)." }),
    });
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    assert.equal(body.vex_shift.available, false);
    assert.equal(body.vex_shift.status, "collecting");
    assert.equal(body.vex_shift.summary, undefined);
  });

  test("outside RTH, a heatmap with NO vex_shift field stays without one (never fabricated)", async () => {
    mockMarketOpen = false;
    mockHeatmap = liveHeatmap({ shift: realShift() });
    delete (mockHeatmap as { vex_shift?: unknown }).vex_shift;
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    assert.equal(body.vex_shift, undefined, "the gate must not manufacture a vex_shift block that was never present");
  });

  test("DURING RTH, the same real shift/vex_shift data passes through unchanged (no regression on the happy path)", async () => {
    mockMarketOpen = true;
    mockHeatmap = liveHeatmap({
      shift: realShift(),
      vex_shift: realShift({ summary: "Over the last 2h14m: net dealer vanna melted -8% (dealers thinning)." }),
    });
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    assert.equal(body.shift.available, true);
    assert.equal(body.shift.summary, realShift().summary);
    assert.equal(body.shift.flip_migration.delta_pts, 2);
    assert.equal(body.vex_shift.available, true);
    assert.equal(body.vex_shift.summary, "Over the last 2h14m: net dealer vanna melted -8% (dealers thinning).");
  });

  test("outside RTH, an ALREADY-collecting shift (cold history, no real data yet) stays available:false (gate is a no-op, not a regression)", async () => {
    mockMarketOpen = false;
    mockHeatmap = liveHeatmap(); // default shift: { available:false, status:"collecting" }, no vex_shift
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    assert.equal(body.shift.available, false);
    assert.equal(body.shift.status, "collecting");
  });
});

// Thermal WS wall override must pass near_term_expiries (same bug class as gex-positioning FINDINGS
// 2026-07-24). Unscoped ladder → far-OpEx walls on the Thermal matrix during RTH.
describe("/api/market/gex-heatmap WS wall override near-term scope", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("live WS override passes near_term_expiries allow-list (not all-expiry)", async () => {
    mockMarketOpen = true;
    mockWsLive = true;
    lastWsLadderAllowList = undefined;
    const NEAR = "2026-07-10";
    const FAR = "2026-09-19";
    mockHeatmap = liveHeatmap({
      underlying: "SPY",
      expiries: [NEAR, FAR],
      near_term_expiries: [NEAR],
      gex: {
        cells: { "100": { [NEAR]: 20 } },
        strike_totals: { "100": 20, "95": -10 },
        call_wall: 100,
        put_wall: 95,
        total: 10,
        flip: 98,
        regime: { flip: 98, posture: "long", read: "ok" },
      },
    });
    // Ladder returns near-term walls; the assertion that matters is the allow-list arg.
    mockWsLadder = {
      ladder: new Map([
        [100, 1_000_000],
        [95, -1_000_000],
      ]),
      updatedAt: Date.now(),
    };

    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=SPY"));
    assert.equal(res.status, 200);
    assert.deepEqual(
      lastWsLadderAllowList,
      [NEAR],
      "Thermal wall override must scope WS ladder to near_term_expiries"
    );
    const body = await res.json();
    assert.equal(body.gex.call_wall, 100);
    assert.equal(body.gex.put_wall, 95);

    mockWsLive = false;
    mockWsLadder = null;
  });

  test("when WS is not live, override is skipped and Polygon walls stand", async () => {
    mockMarketOpen = true;
    mockWsLive = false;
    lastWsLadderAllowList = undefined;
    mockWsLadder = {
      ladder: new Map([[650, 99_000_000]]),
      updatedAt: Date.now(),
    };
    mockHeatmap = liveHeatmap({
      underlying: "SPY",
      gex: {
        cells: {},
        strike_totals: { "100": 20, "95": -10 },
        call_wall: 100,
        put_wall: 95,
        total: 10,
        flip: 98,
        regime: { flip: 98, posture: "long", read: "ok" },
      },
    });
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=SPY"));
    const body = await res.json();
    assert.equal(lastWsLadderAllowList, undefined, "ladder must not be consulted when WS idle");
    assert.equal(body.gex.call_wall, 100);
    assert.equal(body.gex.put_wall, 95);
    mockWsLadder = null;
  });

  // Regression (docs/audit/FINDINGS.md, P0, 2026-08-29): live scripts/full-site-deep-audit.mjs
  // caught prod serving `call_wall: 330` while independently re-deriving 320 as the tallest
  // strike from the SAME response's `strike_totals` — twice, 22 minutes apart. Root cause: the
  // WS override replaced `call_wall`/`put_wall` with a pick from the LIVE UW ladder, but left
  // `strike_totals` (what actually paints the Thermal heatmap bars) on the stale Polygon values,
  // so the labeled wall and the tallest rendered bar could point at two different strikes.
  test("when the live WS ladder disagrees with Polygon's strike_totals, the served call_wall/put_wall and strike_totals stay mutually consistent", async () => {
    mockMarketOpen = true;
    mockWsLive = true;
    // Polygon (cached) heatmap: cells/strike_totals say the wall is 320.
    mockHeatmap = liveHeatmap({
      underlying: "AAPL",
      spot: 322,
      expiries: ["2026-08-29"],
      near_term_expiries: ["2026-08-29"],
      gex: {
        cells: { "320": { "2026-08-29": 20_000_000 }, "310": { "2026-08-29": -8_000_000 } },
        strike_totals: { "320": 20_000_000, "310": -8_000_000 },
        call_wall: 320,
        put_wall: 310,
        total: 12_000_000,
        flip: 315,
        regime: { flip: 315, posture: "long", read: "ok" },
      },
    });
    // Live UW WS ladder disagrees: it says the wall is 330, not 320.
    mockWsLadder = {
      ladder: new Map([
        [330, 25_000_000],
        [310, -8_000_000],
      ]),
      updatedAt: Date.now(),
    };

    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=AAPL"));
    assert.equal(res.status, 200);
    const body = await res.json();

    // The label must be the WS pick (fresher, matches Vector/Slayer)...
    assert.equal(body.gex.call_wall, 330);
    // ...and strike_totals — what full-site-deep-audit.mjs (and GexHeatmap.tsx's bars) actually
    // read — must agree: the tallest strike in strike_totals must be the SAME strike as call_wall,
    // not the stale Polygon 320.
    const strikeTotals: Record<string, number> = body.gex.strike_totals;
    let derivedCallWall: number | null = null;
    let maxPos = 0;
    for (const [s, g] of Object.entries(strikeTotals)) {
      if (Number(g) > maxPos) {
        maxPos = Number(g);
        derivedCallWall = Number(s);
      }
    }
    assert.equal(derivedCallWall, body.gex.call_wall, "strike_totals must re-derive the same call_wall the response reports");
    // total must still equal the sum of strike_totals (the OTHER invariant the deep audit
    // checks) — not left over from the pre-override Polygon total.
    const sum = Object.values(strikeTotals).reduce((s: number, g) => s + Number(g), 0);
    assert.equal(body.gex.total, sum);

    mockWsLive = false;
    mockWsLadder = null;
  });
});
