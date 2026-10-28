import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Engine B (Banger) open positions live in a completely separate table (banger_positions) from
// the swing_positions rows this route reads via fetchSwingPositionsRange/fetchSwingPositionChain
// — so summary.opens (computed purely from swing_positions chains by buildSwingRecordSummary)
// structurally could never count a banger-origin open position, even after the earlier fix that
// made it count native swing OPEN/HOLD/TRIM rows at all (docs/audit/FINDINGS.md, "summary.opens
// was structurally guaranteed to always read 0"). This is the exact same banger/swing split
// already fixed for bookContextSection's live-book read (docs/audit/FINDINGS.md, "Ask Largo swing
// Book context... blind to 94% of the live open book") — live-verified 2026-09-23: 3 native
// swing_positions opens vs 82 real committed positions on the board (81 banger-origin).
//
// mock.module() resolves relative to THIS file (horizons/route.test.ts pattern). buildSwingRecord/
// buildSwingRecordSummary/selectSwingRecordRootIds/closedDeckSourcesFromChains are deliberately
// REAL here (pure, already unit-tested in record.test.ts) — only the DB/auth/banger boundary is
// faked so the banger fold-in can be observed in isolation.

mock.module("server-only", { namedExports: {} });

let openSwingPositionsRows: unknown[] = [];
let recentlyClosedSwingPositionsRows: unknown[] = [];
let swingPositionChainById: Record<number, unknown[]> = {};
mock.module("../../../../../lib/db", {
  namedExports: {
    requireDatabaseInProduction: () => null,
    fetchSwingPositionsRange: async () => [],
    fetchOpenSwingPositions: async () => openSwingPositionsRows,
    fetchRecentlyClosedSwingPositions: async () => recentlyClosedSwingPositionsRows,
    fetchSwingPositionChain: async (id: number) => swingPositionChainById[id] ?? [],
  },
});
mock.module("../../../../../lib/market-api-auth", {
  namedExports: { authorizeCronOrTierApi: async () => ({ via: "cron" as const }) },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: { requireToolApi: async () => null },
});

let bangerOpenCountCalls = 0;
mock.module("../../../../../lib/banger/positions-db", {
  namedExports: {
    fetchBangerOpenCount: async () => {
      bangerOpenCountCalls++;
      return 81;
    },
  },
});
let bangerEnabled = true;
mock.module("../../../../../lib/banger/flag", {
  namedExports: { isBangerEngineEnabled: () => bangerEnabled },
});

describe("/api/market/swing/record folds Engine B (Banger) opens into summary.opens", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("summary.opens is native swing opens PLUS banger opens, both disclosed separately", async () => {
    bangerOpenCountCalls = 0;
    const res = await GET(new NextRequest("http://localhost/api/market/swing/record"));
    const body = await res.json();
    assert.equal(bangerOpenCountCalls, 1);
    assert.equal(body.summary.nativeOpens, 0, "no swing_positions rows in this fixture");
    assert.equal(body.summary.bangerOpens, 81);
    assert.equal(body.summary.opens, 81, "0 native + 81 banger — must not silently read 0");
  });

  test("a genuinely-open native position outside the days window still counts in nativeOpens (2026-10-25, Ask Largo standing mandate)", async () => {
    // BUG: fetchSwingPositionsRange(since, ...) filters on `session_date >= since` — a currently
    // OPEN/HOLD/TRIM position whose own session_date (entry date) predates the window is invisible
    // to that query, so `selectSwingRecordRootIds` never seeds its root and the chain never enters
    // `records` at all. Live-measured on prod: GET /api/market/swing/record?days=1 reported
    // nativeOpens:0 while days=7/30/90 all reported nativeOpens:2 for the SAME two real positions —
    // "is this position currently open" was silently gated by a historical lookback window it has
    // no logical dependency on. Fixed by independently unioning in fetchOpenSwingPositions()'s rows
    // (unbounded by date, status-filtered) when seeding chain roots.
    openSwingPositionsRows = [
      {
        id: 501,
        root_position_id: null,
        parent_position_id: null,
        roll_seq: 0,
        ticker: "OLDOPEN",
        direction: "long",
        status: "HOLD",
        realized_pnl_pct: null,
        graded_at: null,
        grade_json: null,
        session_date: "2026-01-01", // far outside any days=1..90 window fetchSwingPositionsRange would use
      },
    ];
    swingPositionChainById = { 501: openSwingPositionsRows };
    try {
      const res = await GET(new NextRequest("http://localhost/api/market/swing/record?days=1"));
      const body = await res.json();
      assert.equal(
        body.summary.nativeOpens,
        1,
        "a real OPEN/HOLD/TRIM row must count as an open position regardless of how old its session_date is",
      );
    } finally {
      openSwingPositionsRows = [];
      swingPositionChainById = {};
    }
  });

  test("a position that CLOSED inside the days window but was ENTERED before it still appears in closedDeck (2026-10-26, Ask Largo standing mandate, live repro MRNA#65)", async () => {
    // BUG: the sibling gap to the OLDOPEN fix above. fetchSwingPositionsRange(since, ...) filters
    // on `session_date` (ENTRY date) — a position entered before the window but CLOSED inside it
    // is invisible to `rows`, and `fetchOpenSwingPositions()` can't rescue it either since it's no
    // longer open. Live-measured on prod: MRNA#65 (entered 2026-10-22, closed
    // 2026-10-26T13:46:15Z, a real -34.47% stop) was absent from closedDeck under
    // ?days=1/2/3 and only appeared once days=5+ widened `since` back past the entry date — a
    // member or Largo asking "what closed today" saw nothing despite a real closed position.
    // Fixed by unioning in fetchRecentlyClosedSwingPositions(since)'s rows (filtered on
    // closed_at, unbounded by entry date).
    recentlyClosedSwingPositionsRows = [
      {
        id: 65,
        root_position_id: null,
        parent_position_id: null,
        roll_seq: 0,
        ticker: "MRNA",
        direction: "long",
        status: "CLOSED",
        realized_pnl_pct: -34.47,
        graded_at: "2026-10-26T13:46:15.000Z",
        grade_json: null,
        session_date: "2026-10-22", // entered 4 days before a days=1..3 window's `since` cutoff
        closed_at: "2026-10-26T13:46:15.000Z",
        contract_strike: 185,
        contract_expiry: "2026-10-30",
        contract_type: "call",
        contract_occ: "MRNA261030C00185000",
        contract_delta: 0.62,
        first_seen_at: "2026-10-22T19:13:51.000Z",
        committed_at: "2026-10-22T19:13:51.000Z",
        entry_premium: 17.63,
        peak_premium: 25.75,
        trough_premium: 11.55,
        top_flow_strike: 185,
        archetype: "EVENT_DRIVEN",
        sub_lane: "STANDARD",
      },
    ];
    swingPositionChainById = { 65: recentlyClosedSwingPositionsRows };
    try {
      const res = await GET(new NextRequest("http://localhost/api/market/swing/record?days=1"));
      const body = await res.json();
      const closedRow = body.closedDeck.find((c: { positionId: number }) => c.positionId === 65);
      assert.ok(
        closedRow,
        `expected MRNA#65 in closedDeck under ?days=1 despite its entry predating the window — got: ${JSON.stringify(body.closedDeck)}`,
      );
      assert.equal(closedRow.ticker, "MRNA");
    } finally {
      recentlyClosedSwingPositionsRows = [];
      swingPositionChainById = {};
    }
  });

  test("a sub-$1-premium leg's served grade.entry_premium/exit_mark reproduce its own grade.realized_pnl_pct (2026-10-26, Ask Largo standing mandate)", async () => {
    // BUG: grade_json is written full-precision by roll-plan.ts's gradeParentFromMark
    // (entry_premium/exit_mark/realized_pnl_pct all derived from the SAME unrounded raw mark/
    // entry) and reaches this route untouched (record.ts: "grade: r.grade_json ... passed
    // through untouched"). The route's own roundFloats(responseObj) call rounds the whole
    // payload to 2dp with NO keyDp override, unlike the sibling horizons route (which overrides
    // entryPremium/peakPremium/troughPremium/etc at 4dp specifically to avoid destroying
    // sub-$1-option precision). So grade.entry_premium and grade.exit_mark get independently
    // flattened to 2dp, and recomputing (exit_mark-entry_premium)/entry_premium*100 from the two
    // DISPLAYED numbers no longer reproduces the DISPLAYED grade.realized_pnl_pct sitting right
    // next to them in the same object — a self-contradictory payload for any consumer reading
    // the grade sub-object directly. Live-measured EWZ repro: entry_premium 0.58 (2dp) vs the
    // true ~0.581 is enough, at an ~439% return, to swing the recompute by ~0.87pp.
    const entry = 0.581;
    const mark = 3.13;
    const rawRealizedPnlPct = ((mark - entry) / entry) * 100; // ~438.7263%, full precision
    swingPositionChainById = {
      777: [
        {
          id: 777,
          root_position_id: 777,
          parent_position_id: null,
          roll_seq: 0,
          ticker: "EWZ",
          direction: "long",
          status: "CLOSED",
          realized_pnl_pct: rawRealizedPnlPct,
          graded_at: "2026-10-26T12:00:00Z",
          grade_json: {
            methodology: "swing.roll.markfreeze.v1",
            basis: "live_option_mark_vs_entry_premium",
            entry_premium: entry,
            exit_mark: mark,
            realized_pnl_pct: rawRealizedPnlPct,
          },
        },
      ],
    };
    openSwingPositionsRows = [
      {
        id: 777,
        root_position_id: 777,
        parent_position_id: null,
        roll_seq: 0,
        ticker: "EWZ",
        direction: "long",
        status: "CLOSED",
        realized_pnl_pct: rawRealizedPnlPct,
        graded_at: "2026-10-26T12:00:00Z",
        grade_json: null,
        session_date: "2026-10-26",
      },
    ];
    try {
      const res = await GET(new NextRequest("http://localhost/api/market/swing/record?days=90"));
      const body = await res.json();
      const record = body.records.find((r: { composite: { rootPositionId: number } }) => r.composite.rootPositionId === 777);
      assert.ok(record, "EWZ chain must be present in records");
      const grade = record.legs[0].grade as { entry_premium: number; exit_mark: number; realized_pnl_pct: number };
      const recomputed = ((grade.exit_mark - grade.entry_premium) / grade.entry_premium) * 100;
      const gap = Math.abs(recomputed - grade.realized_pnl_pct);
      assert.ok(
        gap < 0.05,
        `served grade.entry_premium (${grade.entry_premium}) / grade.exit_mark (${grade.exit_mark}) must reproduce ` +
          `grade.realized_pnl_pct (${grade.realized_pnl_pct}) within 0.05pp — recomputed ${recomputed}, gap ${gap}`,
      );
    } finally {
      openSwingPositionsRows = [];
      swingPositionChainById = {};
    }
  });

  test("banger fetch is skipped and contributes 0 when the Engine B kill-switch is off", async () => {
    bangerEnabled = false;
    bangerOpenCountCalls = 0;
    try {
      const res = await GET(new NextRequest("http://localhost/api/market/swing/record"));
      const body = await res.json();
      assert.equal(bangerOpenCountCalls, 0, "fetchBangerOpenCount must not be called when disabled");
      assert.equal(body.summary.bangerOpens, 0);
      assert.equal(body.summary.opens, 0);
    } finally {
      bangerEnabled = true;
    }
  });
});
