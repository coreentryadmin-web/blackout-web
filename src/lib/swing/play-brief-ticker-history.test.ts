/**
 * Regression tests for `loadTickerTrackRecord` (Ask Largo standing mandate, round 19, 2026-09-18):
 * ticker-scoped historical context, distinct from `archetypeTrackRecordSection`'s archetype-scoped
 * citation — see play-brief-ticker-history.ts's file header for the exact gap this closes.
 */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { SwingPositionRow } from "../db";

let mockRows: SwingPositionRow[] = [];
let mockChains: Record<number, SwingPositionRow[]> = {};

function row(over: Partial<SwingPositionRow> & { id: number }): SwingPositionRow {
  return {
    commit_key: `k-${over.id}`,
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-08-01",
    ticker: "AAPL",
    direction: "long",
    sub_lane: "STANDARD",
    archetype: "BREAKOUT",
    top_flow_strike: null,
    contract_strike: 200,
    contract_expiry: "2026-08-21",
    contract_type: "call",
    contract_occ: null,
    contract_delta: 0.6,
    entry_underlying_px: 190,
    thesis_invalidation_px: 180,
    target_underlying_px: 210,
    entry_premium: 5,
    last_mark: null,
    last_mark_at: null,
    peak_premium: 6,
    trough_premium: 4,
    underlying_mfe: 205,
    underlying_mae: 185,
    realized_pnl_pct: null,
    entry_context: {},
    gate_calibration_json: {},
    feature_vector: {},
    plan_json: null,
    scale_out_grade: null,
    grade_json: null,
    grade_methodology: null,
    legacy_grade: null,
    status: "CLOSED",
    first_seen_at: "2026-08-01T13:30:00.000Z",
    committed_at: "2026-08-01T13:30:00.000Z",
    closed_at: "2026-08-05T20:00:00.000Z",
    graded_at: "2026-08-05T20:00:00.000Z",
    updated_at: "2026-08-05T20:00:00.000Z",
    ...over,
  };
}

mock.module("../db", {
  namedExports: {
    fetchSwingPositionsByTicker: async () => mockRows,
    fetchSwingPositionChain: async (rootId: number) => mockChains[rootId] ?? [],
  },
});

describe("loadTickerTrackRecord", () => {
  let loadTickerTrackRecord: typeof import("./play-brief-ticker-history").loadTickerTrackRecord;

  before(async () => {
    // Import AFTER mocking so the module under test picks up the mocked "../db".
    ({ loadTickerTrackRecord } = await import("./play-brief-ticker-history"));
    mockRows = [];
    mockChains = {};
  });

  it("returns null when the ticker has no rows at all", async () => {
    mockRows = [];
    const result = await loadTickerTrackRecord("AAPL", null);
    assert.equal(result, null);
  });

  it("returns null when every root is excluded (self-exclusion of the reviewed chain)", async () => {
    mockRows = [row({ id: 1, realized_pnl_pct: 12 })];
    mockChains = { 1: [row({ id: 1, realized_pnl_pct: 12 })] };
    const result = await loadTickerTrackRecord("AAPL", 1);
    assert.equal(result, null);
  });

  it("returns null when the only roots are still OPEN (unresolved, never counted as 'prior')", async () => {
    const openRow = row({ id: 2, status: "HOLD", realized_pnl_pct: null, graded_at: null });
    mockRows = [openRow];
    mockChains = { 2: [openRow] };
    const result = await loadTickerTrackRecord("AAPL", null);
    assert.equal(result, null);
  });

  it("counts a resolved WIN chain (single leg, positive realized P&L)", async () => {
    const winRow = row({ id: 3, realized_pnl_pct: 40 });
    mockRows = [winRow];
    mockChains = { 3: [winRow] };
    const result = await loadTickerTrackRecord("AAPL", null);
    assert.deepEqual(result, { ticker: "AAPL", priorClosedTrades: 1, wins: 1, losses: 0 });
  });

  it("counts a resolved LOSS chain", async () => {
    const lossRow = row({ id: 4, realized_pnl_pct: -30 });
    mockRows = [lossRow];
    mockChains = { 4: [lossRow] };
    const result = await loadTickerTrackRecord("AAPL", null);
    assert.deepEqual(result, { ticker: "AAPL", priorClosedTrades: 1, wins: 0, losses: 1 });
  });

  it("aggregates across multiple independent chains, excludes the reviewed one, ignores still-open ones", async () => {
    const win1 = row({ id: 10, realized_pnl_pct: 25 });
    const loss1 = row({ id: 11, realized_pnl_pct: -15 });
    const reviewed = row({ id: 12, realized_pnl_pct: 60 }); // this play's OWN chain — must be excluded
    const stillOpen = row({ id: 13, status: "OPEN", realized_pnl_pct: null, graded_at: null });
    mockRows = [win1, loss1, reviewed, stillOpen];
    mockChains = { 10: [win1], 11: [loss1], 12: [reviewed], 13: [stillOpen] };
    const result = await loadTickerTrackRecord("AAPL", 12);
    assert.deepEqual(result, { ticker: "AAPL", priorClosedTrades: 2, wins: 1, losses: 1 });
  });

  it("collapses a rolled chain (multiple legs, one root) into ONE prior trade, not one per leg", async () => {
    // A chain that rolled once: parent leg lost, child leg (the terminal one) won — composite
    // outcome is a LOSS regardless (record.ts's preserved-loss invariant), and it must count as
    // exactly ONE prior trade, not two.
    const parent = row({ id: 20, roll_seq: 0, root_position_id: null, realized_pnl_pct: -10 });
    const child = row({ id: 21, roll_seq: 1, root_position_id: 20, realized_pnl_pct: 50 });
    mockRows = [parent, child];
    mockChains = { 20: [parent, child] };
    const result = await loadTickerTrackRecord("AAPL", null);
    assert.deepEqual(result, { ticker: "AAPL", priorClosedTrades: 1, wins: 0, losses: 1 });
  });

  it("upper-cases the ticker in the returned record regardless of input casing", async () => {
    const winRow = row({ id: 30, ticker: "aapl", realized_pnl_pct: 10 });
    mockRows = [winRow];
    mockChains = { 30: [winRow] };
    const result = await loadTickerTrackRecord("aapl", null);
    assert.equal(result?.ticker, "AAPL");
  });
});
