// src/lib/horizon-outcomes.test.ts — unit tests for the unified cross-lane outcomes read layer.
//
// mapZeroDteOutcome / mapSwingOutcome are pure row->outcome mappers, tested directly against fixture
// rows shaped exactly like the real ZeroDteSetupLogRow / SwingPositionRow (db.ts) — no DB needed.
// fetchUnifiedHorizonOutcomes's DB-calling branches (ZERO_DTE/SWING) are exercised via its `deps`
// injection point (fixture fetchers, no live DB, no --experimental-test-module-mocks needed — db.ts
// creates a real pg Pool on first query, which module-mocking the export still wouldn't avoid cheaply);
// the LEAPS placeholder is tested directly since it never touches the DB (empty by construction).
//
// Run: node --import tsx --test src/lib/horizon-outcomes.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ZeroDteSetupLogRow, SwingPositionRow } from "@/lib/db";
import { mapZeroDteOutcome, mapSwingOutcome, fetchUnifiedHorizonOutcomes } from "./horizon-outcomes.ts";

// ── fixtures: shaped exactly like the real row types (db.ts) ─────────────────────────────────────

function zeroDteRow(overrides: Partial<ZeroDteSetupLogRow> = {}): ZeroDteSetupLogRow {
  return {
    session_date: "2026-07-29",
    ticker: "MU",
    direction: "long",
    top_strike: 120,
    expiry: "2026-07-29",
    score: 70,
    score_max: 72,
    dossier_score: null,
    conviction: "high",
    gross_premium: 100000,
    spike: false,
    underlying_at_flag: 118,
    underlying_latest: 122,
    flags_json: null,
    first_flagged_at: "2026-07-29T14:00:00.000Z",
    last_seen_at: "2026-07-29T15:00:00.000Z",
    close_price: 122,
    move_pct: 3.4,
    direction_hit: true,
    graded_at: "2026-07-29T20:15:00.000Z",
    entry_premium: 2.0,
    flow_avg_fill: 2.05,
    plan_json: null,
    // MID (mechanical) columns — deliberately a LOSS here so the WS-10/WS-11 executable-lane test
    // below (entry_context.executable) actually exercises the "official differs from mid" path.
    plan_outcome: "stopped",
    plan_pnl_pct: -50,
    status: "CLOSED",
    last_mark: null,
    peak_premium: null,
    trough_premium: null,
    gate_calibration_json: null,
    entry_context: null,
    feature_vector: null,
    ...overrides,
  };
}

function swingRow(overrides: Partial<SwingPositionRow> = {}): SwingPositionRow {
  return {
    id: 1,
    commit_key: "NVDA:2026-07-01:0",
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-07-01",
    ticker: "NVDA",
    direction: "long",
    sub_lane: "STANDARD",
    archetype: null,
    top_flow_strike: null,
    contract_strike: null,
    contract_expiry: null,
    contract_type: null,
    contract_occ: null,
    contract_delta: null,
    entry_underlying_px: null,
    thesis_invalidation_px: null,
    target_underlying_px: null,
    entry_premium: 3.0,
    last_mark: null,
    peak_premium: null,
    trough_premium: null,
    underlying_mfe: null,
    underlying_mae: null,
    realized_pnl_pct: 42,
    entry_context: null,
    gate_calibration_json: null,
    feature_vector: null,
    plan_json: null,
    scale_out_grade: null,
    grade_json: { v: 1 },
    grade_methodology: "swing.grade.v1",
    legacy_grade: null,
    status: "CLOSED",
    first_seen_at: "2026-07-01T14:00:00.000Z",
    committed_at: "2026-07-01T14:00:00.000Z",
    closed_at: "2026-07-10T20:00:00.000Z",
    graded_at: "2026-07-10T20:00:00.000Z",
    updated_at: "2026-07-10T20:00:00.000Z",
    ...overrides,
  };
}

// ── mapZeroDteOutcome ──────────────────────────────────────────────────────────────────────────

test("mapZeroDteOutcome: legacy row (no entry_context) — official falls back to mid, a mid loss maps to loss", () => {
  const out = mapZeroDteOutcome(zeroDteRow());
  assert.equal(out.lane, "ZERO_DTE");
  assert.equal(out.source_id, "2026-07-29:MU");
  assert.equal(out.truth_kind, "official");
  assert.equal(out.label, "loss");
  assert.equal(out.pnl_pct, -50);
  assert.equal(out.graded_at, "2026-07-29T20:15:00.000Z");
});

test("mapZeroDteOutcome: WS-10/WS-11 executable lane can flip a mid LOSS into an official WIN (the real 2026-07-29 MU case, OUTCOME-GRADING-SPEC §9)", () => {
  const row = zeroDteRow({
    plan_outcome: "stopped",
    plan_pnl_pct: -50, // mid: a loss
    entry_context: {
      executable: {
        tranches: [{ leg: 1 }], // presence of tranches => WS-11 reconstructed trim-scale
        plan_outcome: "time_stop",
        plan_pnl_pct: 6.25, // official: a win
      },
    },
  });
  const out = mapZeroDteOutcome(row);
  assert.equal(out.label, "win");
  assert.equal(out.pnl_pct, 6.25);
});

test("mapZeroDteOutcome: ungradeable / ungraded row maps to a null label and null pnl", () => {
  const out = mapZeroDteOutcome(zeroDteRow({ plan_outcome: "ungradeable", plan_pnl_pct: null }));
  assert.equal(out.label, null);
  assert.equal(out.pnl_pct, null);
});

test("mapZeroDteOutcome: exact-zero official pnl maps to breakeven, not win or loss", () => {
  const out = mapZeroDteOutcome(zeroDteRow({ plan_outcome: "time_stop", plan_pnl_pct: 0 }));
  assert.equal(out.label, "breakeven");
  assert.equal(out.pnl_pct, 0);
});

// ── mapSwingOutcome ────────────────────────────────────────────────────────────────────────────

test("mapSwingOutcome: graded row with positive realized_pnl_pct maps to win, truth_kind financial", () => {
  const out = mapSwingOutcome(swingRow());
  assert.equal(out.lane, "SWING");
  assert.equal(out.source_id, "1");
  assert.equal(out.truth_kind, "financial");
  assert.equal(out.label, "win");
  assert.equal(out.pnl_pct, 42);
});

test("mapSwingOutcome: negative realized_pnl_pct maps to loss", () => {
  const out = mapSwingOutcome(swingRow({ realized_pnl_pct: -18 }));
  assert.equal(out.label, "loss");
  assert.equal(out.pnl_pct, -18);
});

test("mapSwingOutcome: exact-zero realized_pnl_pct maps to breakeven", () => {
  const out = mapSwingOutcome(swingRow({ realized_pnl_pct: 0 }));
  assert.equal(out.label, "breakeven");
});

test("mapSwingOutcome: ungraded (graded_at null) row maps to null label/pnl even if realized_pnl_pct is set", () => {
  const out = mapSwingOutcome(swingRow({ graded_at: null, realized_pnl_pct: 42 }));
  assert.equal(out.label, null);
  assert.equal(out.pnl_pct, null);
});

test("mapSwingOutcome: a roll-frozen markfreeze leg (grade_json lacks the five-family shape) still maps via realized_pnl_pct, not grade_json.financial", () => {
  // This is the exact shape roll-plan.ts's gradeParentFromMark writes — no `.financial` key at all.
  const row = swingRow({
    realized_pnl_pct: 12.5,
    grade_json: {
      methodology: "swing.roll.markfreeze.v1",
      basis: "live_option_mark_vs_entry_premium",
      entry_premium: 3.0,
      exit_mark: 3.375,
      realized_pnl_pct: 12.5,
    },
    grade_methodology: "swing.roll.markfreeze.v1",
  });
  const out = mapSwingOutcome(row);
  assert.equal(out.label, "win");
  assert.equal(out.pnl_pct, 12.5);
});

// ── fetchUnifiedHorizonOutcomes: LEAPS placeholder (no DB call needed — empty by construction) ────

test("fetchUnifiedHorizonOutcomes: LEAPS lane always returns [] without touching the DB", async () => {
  const out = await fetchUnifiedHorizonOutcomes({ days: 30, lane: "LEAPS" });
  assert.deepEqual(out, []);
});

// ── fetchUnifiedHorizonOutcomes: ZERO_DTE / SWING branches, DB mocked ─────────────────────────────

test("fetchUnifiedHorizonOutcomes: lane=ZERO_DTE fetches via the injected zerodte fetcher and maps every row, never touches swing", async () => {
  const rows = [zeroDteRow({ ticker: "AAPL" }), zeroDteRow({ ticker: "TSLA", plan_pnl_pct: 80, plan_outcome: "doubled" })];
  const out = await fetchUnifiedHorizonOutcomes({
    days: 10,
    lane: "ZERO_DTE",
    deps: {
      fetchZeroDteSetupLogRange: async () => rows,
      fetchSwingPositionsRange: async () => {
        throw new Error("should not be called for lane=ZERO_DTE");
      },
    },
  });
  assert.equal(out.length, 2);
  assert.ok(out.every((o) => o.lane === "ZERO_DTE"));
});

test("fetchUnifiedHorizonOutcomes: lane=SWING fetches via the injected swing fetcher and maps every row, never touches zerodte", async () => {
  const rows = [swingRow({ id: 5 }), swingRow({ id: 6, realized_pnl_pct: -10 })];
  const out = await fetchUnifiedHorizonOutcomes({
    days: 10,
    lane: "SWING",
    deps: {
      fetchZeroDteSetupLogRange: async () => {
        throw new Error("should not be called for lane=SWING");
      },
      fetchSwingPositionsRange: async () => rows,
    },
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((o) => o.source_id).sort(), ["5", "6"]);
});

test("fetchUnifiedHorizonOutcomes: no lane filter fetches ZERO_DTE + SWING, LEAPS contributes nothing", async () => {
  const out = await fetchUnifiedHorizonOutcomes({
    days: 10,
    deps: {
      fetchZeroDteSetupLogRange: async () => [zeroDteRow()],
      fetchSwingPositionsRange: async () => [swingRow()],
    },
  });
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((o) => o.lane).sort(),
    ["SWING", "ZERO_DTE"]
  );
});
