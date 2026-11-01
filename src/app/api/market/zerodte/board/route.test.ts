import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// 0DTE board route (GET /api/market/zerodte/board) wraps its whole payload in
// roundFloats(payload) with the default dp=2 and NO keyDp override — unlike the sibling
// /marks route (live-marks.ts's ZERODTE_MARKS_WIRE_DP) and the already-fixed
// /nighthawk/horizons route, both of which protect the SAME field names
// (delta/gamma/theta/vega/iv) with a per-key precision override because gamma/vega are
// routinely sub-0.01 and the flat 2dp default silently quantizes a real, honestly-computed
// greek to 0.00 (round-floats.ts's own header names this exact failure mode).
//
// `setups[].plan.greeks` (plan.ts's buildContractPlan, `greeks: input.greeks` — never
// rounded upstream) and `ledger[].greeks` (zerodte-service.ts, `greeks: liveMark?.greeks
// ?? null` straight off the raw live-mark store) are both genuinely unrounded before this
// route's roundFloats() call, so this is the ONLY backstop standing between a real small
// greek and 0.00 on the wire.
//
// mock.module() resolves relative to THIS file (same pattern as the nighthawk/horizons
// route test). roundFloats is deliberately REAL here — the whole point is observing what
// the ROUTE does with it; every other dependency (auth, db, the board builder) is faked so
// a known small greek value can be injected and observed on the served JSON.

mock.module("server-only", { namedExports: {} });

mock.module("../../../../../lib/auth-server", {
  namedExports: { auth: async () => ({ userId: null, sessionClaims: null }) },
});
mock.module("../../../../../lib/admin-access", {
  namedExports: { isAdminUser: async () => false },
});
mock.module("../../../../../lib/db", {
  namedExports: { requireDatabaseInProduction: () => null },
});
mock.module("../../../../../lib/market-api-auth", {
  namedExports: { authorizeCronOrTierApi: async () => ({ via: "cron" as const }) },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: { requireToolApi: async () => null },
});
mock.module("../../../../../lib/ws/init-data-sockets", {
  namedExports: { ensureDataSockets: () => {} },
});
mock.module("../../../../../lib/platform/zerodte-sim-board", {
  namedExports: {
    getSimBoardPayload: async () => ({}) as unknown,
    isSimRequested: () => false,
    shouldServeSimBoard: () => false,
  },
});

// Deep-ITM near-expiry 0DTE contract shape (live-marks.ts's own ZERODTE_MARKS_WIRE_DP doc
// comment: "Live SPY 0DTE gamma is 0.000800; at 2dp that is 0.00 — the number is GONE").
// Real, honestly-computed, small-but-nonzero values — never fabricated — that the OLD flat
// 2dp default destroys.
const REAL_GAMMA = 0.0021;
const REAL_VEGA = 0.0046;
const REAL_THETA = -0.0183;
const REAL_DELTA = 0.42; // unaffected either way (well above 2dp resolution) — sanity check
const REAL_IV = 0.2714;

// A genuine, unrelated money-math float elsewhere in the payload — proves roundFloats is
// still doing its normal job (this must NOT survive at full precision).
const RAW_MONEY_FLOAT = 7499.360000000001;

mock.module("../../../../../lib/platform/zerodte-service", {
  namedExports: {
    // The route now imports its keyDp map from zerodte-service.ts (single source of truth —
    // see that module's ZERODTE_BOARD_WIRE_DP doc comment) instead of keeping its own local
    // copy, so this mock must supply it: mock.module() replaces ALL named exports of the
    // mocked specifier, and an import the real module satisfies but this mock omits resolves
    // to `undefined` — which would silently turn the route's own roundFloats(..., keyDp) call
    // into the flat-2dp default this whole test exists to rule out.
    ZERODTE_BOARD_WIRE_DP: {
      delta: 4,
      theta: 4,
      iv: 4,
      gamma: 6,
      vega: 6,
      put_width_pct: 4,
      call_width_pct: 4,
    },
    getZeroDteBoardPayload: async () => ({
      available: true,
      as_of: "2026-10-26T14:41:00.000Z",
      upstream_ok: true,
      session: { date: "2026-10-26", trading_day: true, heat: { state: "OPEN" } },
      setups: [
        {
          ticker: "SPY",
          plan: {
            mark: RAW_MONEY_FLOAT,
            greeks: { delta: REAL_DELTA, gamma: REAL_GAMMA, theta: REAL_THETA, vega: REAL_VEGA },
          },
        },
      ],
      ledger: [
        {
          ticker: "SPY",
          timeline_tranches: null,
          greeks: { delta: REAL_DELTA, gamma: REAL_GAMMA, theta: REAL_THETA, vega: REAL_VEGA, iv: REAL_IV },
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

describe("GET /api/market/zerodte/board — greek precision", () => {
  test("gamma/theta/vega/iv on both setups[].plan.greeks and ledger[].greeks keep real precision instead of quantizing to 0.00 (Ask Largo audit, 2026-10-26)", async () => {
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("https://blackouttrades.com/api/market/zerodte/board"));
    const body = (await res.json()) as {
      setups: { plan: { mark: number; greeks: Record<string, number> } }[];
      ledger: { greeks: Record<string, number> }[];
    };

    const planGreeks = body.setups[0]!.plan.greeks;
    const ledgerGreeks = body.ledger[0]!.greeks;

    // The regression: these must NOT be 0 (the old flat-2dp behavior) and must round-trip at
    // the sibling /marks route's own precision (gamma/vega 6dp, theta/iv 4dp) rather than
    // being destroyed.
    assert.notEqual(planGreeks.gamma, 0, "setups[].plan.greeks.gamma destroyed to 0.00");
    assert.notEqual(planGreeks.vega, 0, "setups[].plan.greeks.vega destroyed to 0.00");
    assert.notEqual(ledgerGreeks.gamma, 0, "ledger[].greeks.gamma destroyed to 0.00");
    assert.notEqual(ledgerGreeks.vega, 0, "ledger[].greeks.vega destroyed to 0.00");

    assert.equal(planGreeks.gamma, REAL_GAMMA);
    assert.equal(planGreeks.vega, REAL_VEGA);
    assert.equal(planGreeks.theta, REAL_THETA);
    assert.equal(ledgerGreeks.gamma, REAL_GAMMA);
    assert.equal(ledgerGreeks.vega, REAL_VEGA);
    assert.equal(ledgerGreeks.theta, REAL_THETA);
    assert.equal(ledgerGreeks.iv, REAL_IV);

    // Sanity: roundFloats is still doing its normal job on an unrelated money-math float.
    assert.equal(body.setups[0]!.plan.mark, 7499.36);
  });
});
