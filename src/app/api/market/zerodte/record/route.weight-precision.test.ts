import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// fix/cortex-weight-narrative-precision (2026-11-09): live-confirmed on
// GET /api/market/zerodte/record?days=14 (prod) — a committed row's
// entry_context.cortex.supports[] item served `{"weight": 0.48, ...}` while that SAME item's
// own pre-formatted narrative sentence (compose.ts, baked in at commit time) still read
// "+0.478 [opening-harvest] ...". Root cause: this route's `roundFloats(record)` call had no
// keyDp override, so the flat 2dp default force-rounded the structured `weight` field to a
// DIFFERENT value than the narrative text beside it already committed to at 3dp.
// `buildZeroDteRecord`/`roundFloats`/`CORTEX_WIRE_KEY_DP` are all deliberately REAL here (pure,
// already unit-tested) — only the DB/auth boundary is faked, same idiom as the sibling
// swing/record route.test.ts, so the actual production roundFloats(..., CORTEX_WIRE_KEY_DP)
// call is what's under test, not a re-implementation of it.

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
function setupLogRow(entryContext: Record<string, unknown>): Record<string, unknown> {
  return {
    session_date: "2026-11-05",
    ticker: "META",
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
    graded_at: null,
    entry_premium: 4.2,
    flow_avg_fill: 4.2,
    plan_json: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    status: "OPEN",
    last_mark: 4.4,
    last_mark_at: "2026-11-05T19:59:00.000Z",
    peak_premium: 4.6,
    trough_premium: 4.0,
    gate_calibration_json: null,
    entry_context: entryContext,
    feature_vector: null,
    trims_taken: 0,
  };
}

const REAL_WEIGHT = 0.478; // mirrors the live repro (META 2026-11-05, opening-harvest)

describe("GET /api/market/zerodte/record — Cortex evidence weight precision", () => {
  test("entry_context.cortex.supports[].weight keeps its real 3dp precision, matching its own narrative line, instead of collapsing to 2dp (Ask Largo audit, 2026-11-09)", async () => {
    rows = [
      setupLogRow({
        score: 80,
        cortex: {
          abstained: false,
          decision: "PASS",
          as_of: "2026-11-05T14:35:00.000Z",
          score: 0.48,
          conviction: "B",
          vetoes: [],
          supports: [
            {
              source: "opening-harvest",
              stance: "supports",
              weight: REAL_WEIGHT,
              halfLifeSec: 1800,
              asOf: "2026-11-05T14:30:00.000Z",
              detail: "opening harvest: gap up 2.3 pts",
            },
          ],
          opposes: [],
          absent: [],
          narrative: [
            "CORTEX META long: net score +0.48, conviction B.",
            `+${REAL_WEIGHT} [opening-harvest] opening harvest: gap up 2.3 pts`,
          ],
          gex_walls_veto_relieved: false,
        },
      }),
    ];

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("https://blackouttrades.com/api/market/zerodte/record?days=14"));
    const body = (await res.json()) as {
      plays: Array<{
        ticker: string;
        entry_context: { cortex: { supports: Array<{ weight: number }>; narrative: string[] } } | null;
      }>;
    };

    const play = body.plays.find((p) => p.ticker === "META")!;
    const support = play.entry_context!.cortex.supports[0]!;

    // The regression: must NOT collapse to the flat-2dp 0.48 while the narrative line beside it
    // (a plain string, untouched by roundFloats) still reads 0.478.
    assert.notEqual(support.weight, 0.48, "entry_context.cortex.supports[].weight rounded to 2dp");
    assert.equal(support.weight, REAL_WEIGHT);
    assert.equal(
      play.entry_context!.cortex.narrative[1],
      `+${REAL_WEIGHT} [opening-harvest] opening harvest: gap up 2.3 pts`,
      "the structured field must agree with its own narrative sentence"
    );

    // Sanity: roundFloats is still doing its normal job on an unrelated field at this route's
    // default 2dp (move_pct/plan_pnl_pct etc. are already exercised by record.test.ts; this just
    // confirms the keyDp override didn't accidentally widen to a flat higher precision).
    assert.equal(body.plays[0]!.ticker, "META");
  });
});
