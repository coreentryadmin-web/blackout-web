import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// BUG FIX (2026-11-09, five-engine-largo-cycle audit): the admin ?sim=1 preview branch of this
// route called `roundFloats(await getSimBoardPayload())` with NO keyDp override — unlike the
// member branch three lines below, which carries ZERODTE_BOARD_WIRE_DP specifically because the
// flat 2dp default silently quantizes real sub-cent greeks (gamma/vega) and condor calibration-
// bucket widths (put_width_pct/call_width_pct — e.g. 0.00825, the 92% win-rate bucket boundary,
// collapsing to the indistinguishable 0.01) to zero/rounded-away. Neither getSimBoardPayload()
// nor the admin ingest route round the posted frame upstream ("written verbatim to the sim key"),
// so this route's own roundFloats call is the only chokepoint that could protect precision on
// this path — and until this fix, it didn't.
//
// This is a SEPARATE test file from route.test.ts (the member-path greek-precision test) rather
// than an addition to it, because mock.module() fixes each mocked module's exports for the whole
// file at import time, and route.test.ts's existing mocks hardcode the sim gate OFF
// (isSimRequested/shouldServeSimBoard → false, authorizeCronOrTierApi → {via:"cron"},
// isAdminUser → false) — exactly what this test needs to be true.

mock.module("server-only", { namedExports: {} });

mock.module("../../../../../lib/auth-server", {
  namedExports: { auth: async () => ({ userId: "admin-1", sessionClaims: { foo: "bar" } }) },
});
mock.module("../../../../../lib/admin-access", {
  namedExports: { isAdminUser: async () => true },
});
mock.module("../../../../../lib/db", {
  namedExports: { requireDatabaseInProduction: () => null },
});
mock.module("../../../../../lib/market-api-auth", {
  namedExports: {
    authorizeCronOrTierApi: async () => ({ via: "user" as const, userId: "admin-1" }),
  },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: { requireToolApi: async () => null },
});
mock.module("../../../../../lib/ws/init-data-sockets", {
  namedExports: { ensureDataSockets: () => {} },
});

// Real sub-cent greeks (same values route.test.ts uses for the member path) plus a condor width
// sitting exactly on a live calibration-bucket boundary — the two field families
// ZERODTE_BOARD_WIRE_DP exists to protect.
const REAL_GAMMA = 0.0021;
const REAL_VEGA = 0.0046;
const REAL_THETA = -0.0183;
const REAL_IV = 0.2714;
const CONDOR_WIDTH_PCT = 0.00825;
// ZERODTE_BOARD_WIRE_DP rounds put_width_pct/call_width_pct at 4dp (not infinite precision) —
// 0.00825 correctly rounds to 0.0083 there, which is still distinct from the destructive flat-2dp
// collapse (0.01) this fix prevents. Assert against the correctly-rounded value, not the raw input.
const CONDOR_WIDTH_PCT_ROUNDED = 0.0083;
const RAW_MONEY_FLOAT = 7499.360000000001;

mock.module("../../../../../lib/platform/zerodte-sim-board", {
  namedExports: {
    isSimRequested: (p: string | null) => p === "1",
    shouldServeSimBoard: (isAdmin: boolean, simRequested: boolean) => isAdmin && simRequested,
    getSimBoardPayload: async () => ({
      available: true,
      as_of: "2026-11-09T00:00:00.000Z",
      upstream_ok: true,
      session: { date: "2026-11-09", trading_day: true, heat: { state: "OPEN" } },
      setups: [
        {
          ticker: "SPY",
          plan: {
            mark: RAW_MONEY_FLOAT,
            greeks: { gamma: REAL_GAMMA, vega: REAL_VEGA, theta: REAL_THETA },
            condor: { call_width_pct: CONDOR_WIDTH_PCT, put_width_pct: CONDOR_WIDTH_PCT },
          },
        },
      ],
      ledger: [
        {
          ticker: "SPY",
          timeline_tranches: null,
          greeks: { gamma: REAL_GAMMA, vega: REAL_VEGA, theta: REAL_THETA, iv: REAL_IV },
          condor: { call_width_pct: CONDOR_WIDTH_PCT, put_width_pct: CONDOR_WIDTH_PCT },
        },
      ],
      discovery_health: {},
      covered_elsewhere: [],
      governor: null,
      allocation: [],
      market_state: null,
      discovery_funnel: null,
      spx_slayer_badge: null,
      session_stats: null,
      vector_pulse_by_ticker: {},
      vector_near_misses: [],
      veto_shadow: null,
    }),
  },
});

mock.module("../../../../../lib/platform/zerodte-service", {
  namedExports: {
    // Supplied even though getZeroDteBoardPayload is never reached on this path — mock.module()
    // replaces ALL named exports of the mocked specifier, and the route imports both names from
    // the same module.
    ZERODTE_BOARD_WIRE_DP: {
      delta: 4,
      theta: 4,
      iv: 4,
      gamma: 6,
      vega: 6,
      put_width_pct: 4,
      call_width_pct: 4,
    },
    getZeroDteBoardPayload: async () => {
      throw new Error("member path must not be reached when ?sim=1 is served to an admin");
    },
  },
});

describe("GET /api/market/zerodte/board?sim=1 — admin sim preview greek/condor precision", () => {
  test("gamma/vega/theta/iv and condor width keep real precision instead of quantizing to 0.00/0.01 (2026-11-09 audit)", async () => {
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("https://blackouttrades.com/api/market/zerodte/board?sim=1"));
    const body = (await res.json()) as {
      setups: {
        plan: { mark: number; greeks: Record<string, number>; condor: Record<string, number> };
      }[];
      ledger: { greeks: Record<string, number>; condor: Record<string, number> }[];
    };

    assert.equal(res.headers.get("X-Zerodte-Sim"), "1", "must have served the sim branch, not the member branch");

    const planGreeks = body.setups[0]!.plan.greeks;
    const ledgerGreeks = body.ledger[0]!.greeks;

    // The regression: these must NOT collapse to 0/0.01 (the old flat-2dp behavior).
    assert.notEqual(planGreeks.gamma, 0, "setups[].plan.greeks.gamma destroyed to 0.00");
    assert.notEqual(planGreeks.vega, 0, "setups[].plan.greeks.vega destroyed to 0.00");
    assert.notEqual(ledgerGreeks.gamma, 0, "ledger[].greeks.gamma destroyed to 0.00");
    assert.notEqual(ledgerGreeks.vega, 0, "ledger[].greeks.vega destroyed to 0.00");
    assert.notEqual(
      body.setups[0]!.plan.condor.call_width_pct,
      0.01,
      "condor call_width_pct collapsed to the indistinguishable 0.01 default"
    );

    assert.equal(planGreeks.gamma, REAL_GAMMA);
    assert.equal(planGreeks.vega, REAL_VEGA);
    assert.equal(planGreeks.theta, REAL_THETA);
    assert.equal(ledgerGreeks.gamma, REAL_GAMMA);
    assert.equal(ledgerGreeks.vega, REAL_VEGA);
    assert.equal(ledgerGreeks.theta, REAL_THETA);
    assert.equal(ledgerGreeks.iv, REAL_IV);
    assert.equal(body.setups[0]!.plan.condor.call_width_pct, CONDOR_WIDTH_PCT_ROUNDED);
    assert.equal(body.setups[0]!.plan.condor.put_width_pct, CONDOR_WIDTH_PCT_ROUNDED);
    assert.equal(body.ledger[0]!.condor.call_width_pct, CONDOR_WIDTH_PCT_ROUNDED);

    // Sanity: roundFloats is still doing its normal job on an unrelated money-math float.
    assert.equal(body.setups[0]!.plan.mark, 7499.36);
  });
});
