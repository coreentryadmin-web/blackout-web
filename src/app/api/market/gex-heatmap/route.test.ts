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

mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    authorizeMarketDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});
mock.module("../../../../lib/tool-access-server", {
  namedExports: {
    requireToolApi: async () => null, // tool launched — never gate the test
  },
});
mock.module("../../../../lib/providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async () => {
      fetchGexHeatmapCalls++;
      return mockHeatmap;
    },
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
    source: "polygon",
    data_delay: "15-min delayed",
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

  test("a null heatmap (Polygon unavailable) still short-circuits to the pre-existing available:false contract", async () => {
    mockHeatmap = null;
    const callsBefore = fetchGexHeatmapCalls;
    const res = await GET(new NextRequest("http://localhost/api/market/gex-heatmap?ticker=ZZZZ"));
    const body = await res.json();
    assert.equal(body.available, false);
    assert.equal(body.underlying, "ZZZZ");
    assert.equal(fetchGexHeatmapCalls, callsBefore + 1);
    // The null path is the minimal { available, underlying } shape — it never merges heatmap
    // fields (there's nothing to merge), unlike the non-null-but-empty case above which still
    // spreads the full (empty-valued) heatmap object.
    assert.equal(body.strikes, undefined);
  });
});
