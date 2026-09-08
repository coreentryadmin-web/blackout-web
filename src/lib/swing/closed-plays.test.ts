import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closedDeckSourceFromRow, closedDeckSourcesFromChains } from "./closed-plays";
import type { SwingPositionRow } from "../db";

function row(overrides: Partial<SwingPositionRow> = {}): SwingPositionRow {
  return {
    id: 1,
    commit_key: "k",
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-08-01",
    ticker: "NVDA",
    direction: "long",
    sub_lane: "standard",
    archetype: "MOMENTUM",
    top_flow_strike: 180,
    contract_strike: 180,
    contract_expiry: "2026-08-15",
    contract_type: "call",
    contract_occ: "O:NVDA250815C00180000",
    contract_delta: 0.55,
    entry_underlying_px: 175,
    thesis_invalidation_px: 170,
    target_underlying_px: 190,
    entry_premium: 5.0,
    last_mark: 6.5,
    last_mark_at: "2026-08-10T15:00:00Z",
    peak_premium: 7.0,
    trough_premium: 4.2,
    underlying_mfe: 8,
    underlying_mae: -2,
    realized_pnl_pct: 30,
    entry_context: null,
    gate_calibration_json: null,
    feature_vector: { evidence_score: 82 },
    plan_json: null,
    scale_out_grade: null,
    grade_json: {},
    grade_methodology: "swing",
    legacy_grade: null,
    status: "CLOSED",
    first_seen_at: "2026-08-01T10:00:00Z",
    committed_at: "2026-08-02T14:30:00Z",
    closed_at: "2026-08-10T16:00:00Z",
    graded_at: "2026-08-10T16:05:00Z",
    updated_at: "2026-08-10T16:05:00Z",
    ...overrides,
  };
}

describe("closedDeckSourceFromRow", () => {
  it("maps graded CLOSED row to CLOSED deck source", () => {
    const src = closedDeckSourceFromRow(row());
    assert.equal(src?.status, "CLOSED");
    assert.equal(src?.exitPnlPct, 30);
    assert.equal(src?.closedReason, "target");
    assert.equal(src?.positionId, 1);
  });

  it("skips open rows and ungraded closes", () => {
    assert.equal(closedDeckSourceFromRow(row({ status: "OPEN" })), null);
    assert.equal(closedDeckSourceFromRow(row({ graded_at: null })), null);
  });

  it("freezes dte to the trade's own exit date, never recomputed against today (FINDINGS 2026-09-06)", () => {
    // Fixture's expiry (2026-08-15) and closed_at (2026-08-10) are both far in this test's
    // past relative to whenever the suite actually runs — a live `calendarDte(today, expiry)`
    // read would go negative (contract already expired) the moment "today" outran the expiry,
    // and would silently change on every re-run before that. The honest DTE-at-exit value is
    // fixed by the row's own timestamps and must never move: 2026-08-10 -> 2026-08-15 = 5.
    const src = closedDeckSourceFromRow(row());
    assert.equal(src?.contract.dte, 5, "dte must be frozen at exit (closed_at), not live against now()");
  });

  it("still reports a sane frozen dte for an already-expired contract (EWZ/GLW shape)", () => {
    // Reproduces the exact live production shape from the audit: expiry == closed_at date (the
    // contract expired the same session the position was closed/graded). A live `now()` read
    // taken any day after would print negative; the frozen exit-date read must stay 0, forever.
    const src = closedDeckSourceFromRow(
      row({
        contract_expiry: "2026-09-04",
        closed_at: "2026-09-04T20:05:00Z",
        graded_at: "2026-09-04T20:10:00Z",
      }),
    );
    assert.equal(src?.contract.dte, 0);
  });

  it("falls back to graded_at when closed_at is absent", () => {
    const src = closedDeckSourceFromRow(row({ closed_at: null, graded_at: "2026-08-12T16:05:00Z" }));
    assert.equal(src?.contract.dte, 3, "2026-08-12 -> 2026-08-15 expiry = 3 dte at grading time");
    assert.equal(src?.exitAt, "2026-08-12T16:05:00Z");
  });
});

describe("closedDeckSourcesFromChains", () => {
  it("emits one row per resolved chain using chain-composite P&L (Q26)", () => {
    const parent = row({ id: 10, roll_seq: 0, realized_pnl_pct: -20, graded_at: "2026-08-05T12:00:00Z" });
    const child = row({
      id: 11,
      roll_seq: 1,
      parent_position_id: 10,
      root_position_id: 10,
      realized_pnl_pct: 15,
      closed_at: "2026-08-12T12:00:00Z",
      graded_at: "2026-08-12T12:05:00Z",
    });
    const out = closedDeckSourcesFromChains([[parent, child]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.positionId, 11);
    assert.equal(out[0]!.exitPnlPct, -20, "worst-leg composite, not terminal-leg +15");
    assert.equal(out[0]!.closedReason, "stopped");
  });
});
