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
