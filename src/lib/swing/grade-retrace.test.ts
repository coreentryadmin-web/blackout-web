import { test } from "node:test";
import assert from "node:assert/strict";
import { swingArchetypeFromRow, swingBarWindow, swingRowToGradeInput, swingSubLaneFromRow } from "./grade-retrace";
import type { SwingPositionRow } from "../db";
import { gradeSwingPosition } from "./grade";

function baseRow(overrides: Partial<SwingPositionRow> = {}): SwingPositionRow {
  return {
    id: 1,
    commit_key: "k",
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-09-01",
    ticker: "CRWD",
    direction: "long",
    sub_lane: "STANDARD",
    archetype: "BREAKOUT",
    top_flow_strike: null,
    contract_strike: 500,
    contract_expiry: "2026-09-19",
    contract_type: "call",
    contract_occ: "O:CRWD260919C00500000",
    contract_delta: 0.6,
    entry_underlying_px: 480,
    thesis_invalidation_px: 460,
    target_underlying_px: 520,
    entry_premium: 10,
    last_mark: null,
    last_mark_at: null,
    peak_premium: null,
    trough_premium: null,
    underlying_mfe: null,
    underlying_mae: null,
    realized_pnl_pct: 15,
    entry_context: null,
    gate_calibration_json: null,
    feature_vector: null,
    plan_json: null,
    scale_out_grade: null,
    grade_json: null,
    grade_methodology: null,
    legacy_grade: null,
    status: "CLOSED",
    first_seen_at: "2026-09-01T13:00:00Z",
    committed_at: "2026-09-01T13:00:00Z",
    closed_at: "2026-09-08T20:00:00Z",
    graded_at: "2026-09-08T20:00:01Z",
    updated_at: "2026-09-08T20:00:01Z",
    ...overrides,
  };
}

test("swingSubLaneFromRow: recognized value casts through, unrecognized/legacy degrades to null", () => {
  assert.equal(swingSubLaneFromRow(baseRow({ sub_lane: "TACTICAL" })), "TACTICAL");
  assert.equal(swingSubLaneFromRow(baseRow({ sub_lane: "legacy" })), null);
});

test("swingArchetypeFromRow: recognized value casts through, null/unrecognized degrades to null", () => {
  assert.equal(swingArchetypeFromRow(baseRow({ archetype: "MEAN_REVERSION" })), "MEAN_REVERSION");
  assert.equal(swingArchetypeFromRow(baseRow({ archetype: null })), null);
  assert.equal(swingArchetypeFromRow(baseRow({ archetype: "not_a_real_archetype" })), null);
});

test("swingRowToGradeInput: direction lowercases through the row and uppercases into the grade input", () => {
  const long = swingRowToGradeInput(baseRow({ direction: "long" }), []);
  const short = swingRowToGradeInput(baseRow({ direction: "short" }), []);
  assert.equal(long.direction, "LONG");
  assert.equal(short.direction, "SHORT");
});

test("swingRowToGradeInput: EXECUTION is honestly ungradeable (no real fill price is ever recorded)", () => {
  const input = swingRowToGradeInput(baseRow(), []);
  assert.equal(input.actualEntryPx, null);
  const grade = gradeSwingPosition(input);
  assert.equal(grade.execution.gradeable, false);
  assert.equal(grade.execution.reason, "no_fill");
});

test("swingRowToGradeInput: FINANCIAL/MANAGEMENT are honestly ungradeable (no option bars fetched this pass)", () => {
  const input = swingRowToGradeInput(baseRow(), [{ t: 1, h: 500, l: 460, c: 480 }]);
  const grade = gradeSwingPosition(input);
  assert.equal(grade.financial.ungradeable, true);
  assert.equal(grade.financial.reason, "no_forward_bars");
  assert.equal(grade.management.gradeable, false);
});

test("swingRowToGradeInput feeds a real underlying series through to a gradeable PATH + THESIS", () => {
  // Entry 480, target 520, stop 460 — a walk that confirms the target without ever touching the stop.
  const bars = [
    { t: 1, h: 495, l: 478, c: 490 },
    { t: 2, h: 525, l: 488, c: 522 },
  ];
  const input = swingRowToGradeInput(baseRow(), bars);
  const grade = gradeSwingPosition(input);
  assert.equal(grade.path.gradeable, true);
  assert.equal(grade.path.mfePct, round2(((525 - 480) / 480) * 100));
  assert.equal(grade.thesis.gradeable, true);
  assert.equal(grade.thesis.outcome, "CONFIRMED");
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

test("swingBarWindow: widens [committed_at, closed_at] by one day on each side", () => {
  const w = swingBarWindow(baseRow());
  assert.deepEqual(w, { from: "2026-08-31", to: "2026-09-09" });
});

test("swingBarWindow: falls back to session_date when committed_at/closed_at are absent", () => {
  const w = swingBarWindow(baseRow({ committed_at: null, closed_at: null, session_date: "2026-09-01" }));
  assert.deepEqual(w, { from: "2026-08-31", to: "2026-09-02" });
});

test("swingBarWindow: returns null when neither timestamp nor session_date is usable", () => {
  const w = swingBarWindow(baseRow({ committed_at: null, closed_at: null, session_date: "" as unknown as string }));
  assert.equal(w, null);
});
