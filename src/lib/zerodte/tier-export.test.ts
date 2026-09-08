import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTierExportRow } from "./tier-export";
import type { ZeroDteSetupLogRow } from "@/lib/db";

/** Canonical A-tier pinned entry_context blob (same fixture as calibration.test.ts's
 *  TIER_CTX.A, verified by tiers.test.ts). */
const A_TIER_CTX = {
  score: 78,
  vix_open: 16,
  committed_at_et: "2026-07-10 12:00 ET",
  cortex: { abstained: false, score: 1.5, vetoes: [], supports: [{}, {}] },
  exit_policy_at_commit: "trim_scale",
};

function row(overrides: Partial<ZeroDteSetupLogRow> = {}): ZeroDteSetupLogRow {
  return {
    session_date: "2026-08-20",
    ticker: "SPY",
    direction: "long",
    top_strike: 550,
    expiry: "2026-08-20",
    score: 78,
    score_max: 100,
    dossier_score: null,
    conviction: null,
    gross_premium: null,
    spike: false,
    underlying_at_flag: null,
    underlying_latest: null,
    flags_json: null,
    first_flagged_at: "2026-08-20T14:35:00.000Z",
    last_seen_at: "2026-08-20T14:35:00.000Z",
    close_price: null,
    move_pct: null,
    direction_hit: null,
    graded_at: "2026-08-20T20:00:00.000Z",
    entry_premium: 3.5,
    flow_avg_fill: null,
    plan_json: null,
    plan_outcome: "doubled",
    plan_pnl_pct: 100,
    status: "CLOSED",
    last_mark: null,
    last_mark_at: null,
    peak_premium: null,
    trough_premium: null,
    gate_calibration_json: null,
    entry_context: A_TIER_CTX,
    feature_vector: null,
    ...overrides,
  };
}

test("buildTierExportRow: real tier + the fields a historical backtest needs to re-price the contract", () => {
  const out = buildTierExportRow(row());
  assert.equal(out.tier, "A");
  assert.equal(out.entry_premium, 3.5);
  assert.equal(out.top_strike, 550);
  assert.equal(out.expiry, "2026-08-20");
  assert.equal(out.exit_policy_at_commit, "trim_scale");
  assert.equal(out.plan_outcome, "doubled");
});

test("buildTierExportRow: pre-context row is untiered (null), never fabricated as C", () => {
  const out = buildTierExportRow(row({ entry_context: null }));
  assert.equal(out.tier, null);
  assert.equal(out.exit_policy_at_commit, null);
});

test("buildTierExportRow: exit_policy_at_commit absent from the blob reads as null, not a crash", () => {
  const { exit_policy_at_commit: _drop, ...rest } = A_TIER_CTX;
  const out = buildTierExportRow(row({ entry_context: rest }));
  assert.equal(out.exit_policy_at_commit, null);
  assert.equal(out.tier, "A"); // tier derivation is unaffected by the missing field
});

test("buildTierExportRow: replay fields surface frozen runner + executable grades", () => {
  const out = buildTierExportRow(
    row({
      entry_context: {
        ...A_TIER_CTX,
        play_type: "DIRECTIONAL",
        session_regime: "trend",
        runner_profile: { target_pct: 400, tag: "runner_vector", regime: "trend" },
        exit_policy_snapshot: {
          policy: "trim_scale",
          target_pct: 400,
          hard_stop_pct: -50,
          trim_levels: [{ trigger_pct: 40, fraction: 0.4 }],
          runner_fraction: 0.6,
          config_hash: "test",
        },
        executable: { plan_pnl_pct: 185.5, plan_outcome: "doubled" },
      },
      peak_premium: 8.4,
      trough_premium: 2.1,
    })
  );
  assert.equal(out.play_type, "DIRECTIONAL");
  assert.equal(out.session_regime, "trend");
  assert.equal(out.runner_target_pct, 400);
  assert.equal(out.runner_tag, "runner_vector");
  assert.equal(out.stored_executable_pnl_pct, 185.5);
  assert.equal(out.peak_premium, 8.4);
});

test("buildTierExportRow: condor geometry + frozen policy for session replay", () => {
  const out = buildTierExportRow(
    row({
      entry_context: {
        ...A_TIER_CTX,
        play_type: "CONDOR",
        condor: {
          breach_lower: 548,
          breach_upper: 552,
          net_credit: 0.85,
          max_loss: 4.15,
          gross_wing_risk: 5,
          net_credit_mid: 0.92,
        },
        exit_policy_snapshot: {
          policy: "trim_scale",
          target_pct: 100,
          hard_stop_pct: -50,
          trim_levels: [],
          runner_fraction: 0.5,
          config_hash: "condor-test",
          time_stop_et_minutes: 15 * 60 + 50,
        },
      },
      plan_outcome: "condor_win",
      plan_pnl_pct: 17,
    })
  );
  assert.equal(out.play_type, "CONDOR");
  assert.equal(out.condor?.breach_lower, 548);
  assert.equal(out.condor?.net_credit, 0.85);
  assert.equal(out.exit_policy_snapshot?.policy, "trim_scale");
});
