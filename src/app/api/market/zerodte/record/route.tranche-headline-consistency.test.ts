import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// fix/zerodte-tranche-headline-recompute (2026-11-09): live-confirmed on
// GET /api/market/zerodte/record?days=14 (prod), rows committed 2026-11-02...11-05 — i.e. AFTER
// the narrower #6744 fix (2026-10-25, "fraction leaves sum to 0.99, not 1.00") already shipped.
// A member or API consumer who recomputes Σ(fraction_i × exit_pnl_pct_i) from the EXACT served
// `entry_context.executable.tranches[]` array disagrees with the served
// `entry_context.executable.plan_pnl_pct` headline sitting right beside it — by up to 0.56pp.
// Root cause: #6744 only reconciled `fraction`; the served `plan_pnl_pct` was (and, pre-fix,
// still is) the UNROUNDED, pre-reconciliation blend stamped at grading time (plan.ts), while
// `exit_pnl_pct` is independently rounded by the generic roundFloats() walk alongside `fraction`.
//
// `buildZeroDteRecord`/`roundFloats`/`reconcileTrancheFractions` are all deliberately REAL here
// (pure, already unit-tested) — only the DB/auth boundary is faked, same idiom as the sibling
// route.weight-precision.test.ts, so the actual production response-shaping code is what's under
// test, not a re-implementation of it.

mock.module("server-only", { namedExports: {} });

let rows: unknown[] = [];
mock.module("../../../../../lib/db", {
  namedExports: {
    requireDatabaseInProduction: () => null,
    fetchZeroDteSetupLogRange: async () => rows,
  },
});
mock.module("../../../../../lib/market-api-auth", {
  namedExports: { authorizeCronOrTierApi: async () => ({ via: "cron" as const }) },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: { requireToolApi: async () => null },
});

// A real ZeroDteSetupLogRow, minimal but complete — every field buildZeroDteRecord/toPlay reads.
function setupLogRow(ticker: string, entryContext: Record<string, unknown>): Record<string, unknown> {
  return {
    session_date: "2026-11-05",
    ticker,
    direction: "long",
    top_strike: 600,
    expiry: "2026-11-05",
    score: 80,
    score_max: 80,
    dossier_score: null,
    conviction: null,
    gross_premium: 2_000_000,
    spike: false,
    underlying_at_flag: 598,
    underlying_latest: 602,
    flags_json: null,
    first_flagged_at: "2026-11-05T14:35:00.000Z",
    last_seen_at: "2026-11-05T20:00:00.000Z",
    close_price: null,
    move_pct: null,
    direction_hit: null,
    graded_at: "2026-11-05T21:00:00.000Z",
    entry_premium: 4.2,
    flow_avg_fill: 4.2,
    plan_json: null,
    plan_outcome: "doubled",
    plan_pnl_pct: 52.49,
    status: "CLOSED",
    last_mark: 4.4,
    last_mark_at: "2026-11-05T19:59:00.000Z",
    peak_premium: 10,
    trough_premium: 4.0,
    gate_calibration_json: null,
    entry_context: entryContext,
    feature_vector: null,
    trims_taken: 2,
  };
}

// Real production shape (META 2026-11-05 repro): exact 1/3 raw fractions, blended BEFORE
// rounding to the served plan_pnl_pct=52.49 — reconstructTrimScaleExecutableFromBars's own
// round2(Σ fraction_i(unrounded) × exit_pnl_pct_i) === round2((16.8+46+94.67)/3) === 52.49.
const RAW_THIRD = 1 / 3;
const META_EXECUTABLE = {
  lane: "conservative",
  entry_basis: "ask",
  exit_basis: "bid",
  half_spread_frac: 0.05,
  plan_outcome: "doubled",
  plan_pnl_pct: 52.49,
  mid_plan_outcome: "doubled",
  mid_plan_pnl_pct: 53.1,
  execution_tax_bps: 12,
  tranches: [
    { tranche: 1, fraction: RAW_THIRD, exit_pnl_pct: 16.8, exit_reason: "trim_scale_first", at_et: "10:00" },
    { tranche: 2, fraction: RAW_THIRD, exit_pnl_pct: 46, exit_reason: "trim_scale_second", at_et: "11:30" },
    { tranche: 3, fraction: RAW_THIRD, exit_pnl_pct: 94.67, exit_reason: "doubled", at_et: "14:15" },
  ],
  exit_policy: "trim_scale",
  broker: null,
};

describe("GET /api/market/zerodte/record — WS-11 tranche headline self-consistency (Ask Largo audit, 2026-11-09)", () => {
  test("entry_context.executable.plan_pnl_pct recomputes EXACTLY from entry_context.executable.tranches[] as served, not the raw pre-reconciliation blend", async () => {
    rows = [setupLogRow("META", { executable: META_EXECUTABLE })];

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("https://blackouttrades.com/api/market/zerodte/record?days=14"));
    const body = (await res.json()) as {
      plays: Array<{
        ticker: string;
        entry_context: {
          executable: { plan_pnl_pct: number; tranches: Array<{ fraction: number; exit_pnl_pct: number }> };
        } | null;
      }>;
    };

    const play = body.plays.find((p) => p.ticker === "META")!;
    const ex = play.entry_context!.executable;

    // #6744's own invariant must still hold: fractions sum to exactly 1.00 (0.33/0.33/0.34).
    const fractionSum = ex.tranches.reduce((acc, t) => acc + t.fraction, 0);
    assert.equal(Math.round(fractionSum * 100) / 100, 1);
    assert.deepEqual(ex.tranches.map((t) => t.fraction), [0.33, 0.33, 0.34]);

    // THE FIX: recomputing the blend from the EXACT served tranches must equal the served
    // headline — this is the self-consistency property the finding says was missing.
    const recomputed = ex.tranches.reduce((acc, t) => acc + t.fraction * t.exit_pnl_pct, 0);
    const recomputedRounded = Math.round(recomputed * 100) / 100;
    assert.equal(
      recomputedRounded,
      ex.plan_pnl_pct,
      `served plan_pnl_pct (${ex.plan_pnl_pct}) must equal the recompute from the served tranches (${recomputedRounded})`
    );

    // Pin the exact live-repro numbers so a regression can't silently move both sides together.
    assert.equal(ex.plan_pnl_pct, 52.91);
    assert.notEqual(ex.plan_pnl_pct, 52.49, "the pre-fix served headline a member could not reproduce");
  });

  test("entry_context.executable.plan_pnl_pct recomputes EXACTLY from tranches[] for the QQQ 2026-10-28 repro (losing runner leg)", async () => {
    const qqqExecutable = {
      ...META_EXECUTABLE,
      plan_outcome: "stopped",
      plan_pnl_pct: 6.35, // round2((19.65+49.56-50.15)/3) === round2(6.3533...) === 6.35
      tranches: [
        { tranche: 1, fraction: RAW_THIRD, exit_pnl_pct: 19.65, exit_reason: "trim_scale_first", at_et: "09:45" },
        { tranche: 2, fraction: RAW_THIRD, exit_pnl_pct: 49.56, exit_reason: "trim_scale_second", at_et: "10:20" },
        { tranche: 3, fraction: RAW_THIRD, exit_pnl_pct: -50.15, exit_reason: "stopped", at_et: "15:05" },
      ],
    };
    rows = [setupLogRow("QQQ", { executable: qqqExecutable })];

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("https://blackouttrades.com/api/market/zerodte/record?days=14"));
    const body = (await res.json()) as {
      plays: Array<{
        ticker: string;
        entry_context: {
          executable: { plan_pnl_pct: number; tranches: Array<{ fraction: number; exit_pnl_pct: number }> };
        } | null;
      }>;
    };

    const play = body.plays.find((p) => p.ticker === "QQQ")!;
    const ex = play.entry_context!.executable;
    const recomputed = ex.tranches.reduce((acc, t) => acc + t.fraction * t.exit_pnl_pct, 0);
    assert.equal(Math.round(recomputed * 100) / 100, ex.plan_pnl_pct);
    assert.equal(ex.plan_pnl_pct, 5.79);
    assert.notEqual(ex.plan_pnl_pct, 6.35);
  });

  test("a single-tranche array (immediate stop, fraction=1) is a provable no-op — served plan_pnl_pct is byte-identical pre/post fix", async () => {
    const singleLegExecutable = {
      ...META_EXECUTABLE,
      plan_outcome: "stopped",
      plan_pnl_pct: -50,
      tranches: [{ tranche: 1, fraction: 1, exit_pnl_pct: -50, exit_reason: "stopped", at_et: "09:35" }],
    };
    rows = [setupLogRow("SPY", { executable: singleLegExecutable })];

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("https://blackouttrades.com/api/market/zerodte/record?days=14"));
    const body = (await res.json()) as {
      plays: Array<{ ticker: string; entry_context: { executable: { plan_pnl_pct: number } } | null }>;
    };
    const play = body.plays.find((p) => p.ticker === "SPY")!;
    assert.equal(play.entry_context!.executable.plan_pnl_pct, -50);
  });

  test("a ratchet/legacy row with no tranches array is untouched (the fix only ever applies when tranches is present)", async () => {
    rows = [
      setupLogRow("AMZN", {
        executable: {
          lane: "conservative",
          entry_basis: "ask",
          exit_basis: "bid",
          half_spread_frac: 0.05,
          plan_outcome: "doubled",
          plan_pnl_pct: 103.4,
          mid_plan_outcome: "doubled",
          mid_plan_pnl_pct: 104,
          execution_tax_bps: 6,
          tranches: null,
          exit_policy: "ratchet",
          broker: null,
        },
      }),
    ];

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("https://blackouttrades.com/api/market/zerodte/record?days=14"));
    const body = (await res.json()) as {
      plays: Array<{ ticker: string; entry_context: { executable: { plan_pnl_pct: number } } | null }>;
    };
    const play = body.plays.find((p) => p.ticker === "AMZN")!;
    assert.equal(play.entry_context!.executable.plan_pnl_pct, 103.4);
  });
});
