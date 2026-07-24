import { test } from "node:test";
import assert from "node:assert/strict";
import {
  labelFromPlanOutcome,
  toGradedFeatureRows,
  summarizeFeatureStore,
  scoreBand,
  flowQualityBand,
  MIN_SAMPLES,
  type RawGradedRow,
  type GradedFeatureRow,
} from "./feature-store.ts";
import type { SetupFeatureVector } from "./feature-vector.ts";

function fv(over: Partial<SetupFeatureVector> = {}): SetupFeatureVector {
  return {
    v: 1, ticker: "SPY", side: "long", tod_min: 60, evidence_score: 78, dossier_score: null,
    fq_score: 70, fq_premium_depth: null, fq_aggression: null, fq_sweep: null, fq_persistence: null,
    fq_concentration: null, fq_momentum: null, fq_institutional: null, fq_dominance: null,
    fq_accelerating: null, fq_prem_per_min: null, fq_net_prem_slope: null,
    reg_structure: "TREND_UP", reg_gap: null, reg_vol: null, reg_opex: null, reg_quad: null, reg_fed: null,
    vwap_dist_pct: null, or_break: null, trend_5m: null, rsi14: null, rel_volume: null, atr14: null,
    gamma_regime: null, gex_king_dist_pct: null, dark_pool_bias: null, vix: null, spy_bias: null, confluence: null,
    ...over,
  };
}

function gr(label: "win" | "loss", over: Partial<SetupFeatureVector> = {}, pnl: number | null = null): GradedFeatureRow {
  return { ticker: "SPY", sessionDate: "2026-07-23", features: fv(over), label, pnlPct: pnl };
}

test("labelFromPlanOutcome: win = positive plan P&L (matches record.ts isZeroDteWin); outcome only gates evidence", () => {
  // Outcome gates evidence; realized P&L decides win/loss — identical to isZeroDteWin (pnl > 0).
  assert.equal(labelFromPlanOutcome("doubled", 100), "win"); // +100% → win
  assert.equal(labelFromPlanOutcome("stopped", -50), "loss"); // −50% → loss
  // The bug this fixes: a GREEN time_stop is a WIN, not a loss (it was previously forced to loss).
  assert.equal(labelFromPlanOutcome("time_stop", 12), "win", "a profitable time_stop is a win");
  assert.equal(labelFromPlanOutcome("time_stop", -8), "loss", "a losing time_stop is a loss");
  assert.equal(labelFromPlanOutcome("time_stop", 0), "loss", "flat (pnl not > 0) is a loss, per isZeroDteWin");
  // Non-graded outcomes are never evidence regardless of any P&L.
  assert.equal(labelFromPlanOutcome("ungradeable", 100), null);
  assert.equal(labelFromPlanOutcome(null, 100), null);
  assert.equal(labelFromPlanOutcome("", 100), null);
  assert.equal(labelFromPlanOutcome("DOUBLED", 100), "win"); // case-insensitive
});

test("toGradedFeatureRows: drops ungradeable rows and rows without a feature vector — never fabricates", () => {
  const raw: RawGradedRow[] = [
    { ticker: "SPY", session_date: "2026-07-23", feature_vector: fv(), plan_outcome: "doubled", plan_pnl_pct: 105 },
    { ticker: "QQQ", session_date: "2026-07-23", feature_vector: fv(), plan_outcome: "stopped", plan_pnl_pct: -48 },
    // a GREEN time_stop — closed profitable before 15:30 — is a WIN (matches record.ts isZeroDteWin).
    { ticker: "AAPL", session_date: "2026-07-23", feature_vector: fv(), plan_outcome: "time_stop", plan_pnl_pct: 14 },
    { ticker: "IWM", session_date: "2026-07-23", feature_vector: fv(), plan_outcome: "ungradeable" }, // dropped
    { ticker: "NVDA", session_date: "2026-07-23", feature_vector: null, plan_outcome: "doubled" }, // no vector → dropped
    { ticker: "AMD", session_date: "2026-07-23", plan_outcome: "doubled" }, // missing vector → dropped
  ];
  const rows = toGradedFeatureRows(raw);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.label), ["win", "loss", "win"]);
  assert.deepEqual(rows.map((r) => r.pnlPct), [105, -48, 14]);
});

test("summarizeFeatureStore: counts are exact but winRate stays null below MIN_SAMPLES (calibration-first)", () => {
  const rows = [gr("win"), gr("win"), gr("loss")]; // 3 rows — below the floor
  const s = summarizeFeatureStore(rows);
  assert.equal(s.overall.n, 3);
  assert.equal(s.overall.wins, 2);
  assert.equal(s.overall.winRate, null, "a rate off 3 trades must be null, not 67%");
});

test("summarizeFeatureStore: winRate resolves once the sample clears MIN_SAMPLES", () => {
  // MIN_SAMPLES wins + MIN_SAMPLES losses = a real 50% on a big-enough sample.
  const rows = [
    ...Array.from({ length: MIN_SAMPLES }, () => gr("win")),
    ...Array.from({ length: MIN_SAMPLES }, () => gr("loss")),
  ];
  const s = summarizeFeatureStore(rows);
  assert.equal(s.overall.n, MIN_SAMPLES * 2);
  assert.equal(s.overall.winRate, 0.5);
});

test("summarizeFeatureStore: cuts by regime structure, score band, and flow-quality band", () => {
  const rows = [
    gr("win", { reg_structure: "TREND_UP", evidence_score: 88, fq_score: 80 }),
    gr("loss", { reg_structure: "RANGE", evidence_score: 70, fq_score: 40 }),
    gr("win", { reg_structure: "TREND_UP", evidence_score: 78, fq_score: 60 }),
  ];
  const s = summarizeFeatureStore(rows);
  assert.equal(s.byRegimeStructure["TREND_UP"]!.n, 2);
  assert.equal(s.byRegimeStructure["TREND_UP"]!.wins, 2);
  assert.equal(s.byRegimeStructure["RANGE"]!.n, 1);
  assert.equal(s.byScoreBand["85+"]!.n, 1);
  assert.equal(s.byScoreBand["75-84"]!.n, 1);
  assert.equal(s.byScoreBand["65-74"]!.n, 1);
  assert.equal(s.byFlowQualityBand["strong"]!.n, 1);
  assert.equal(s.byFlowQualityBand["solid"]!.n, 1);
  assert.equal(s.byFlowQualityBand["weak"]!.n, 1);
});

test("summarizeFeatureStore: coverage separates real signal from not-yet-threaded nulls", () => {
  const rows = [
    gr("win", { fq_score: 70, reg_structure: "TREND_UP" }),
    gr("loss", { fq_score: null, reg_structure: null }), // a pre-threading row
  ];
  const s = summarizeFeatureStore(rows);
  assert.deepEqual(s.fqCoverage, { withFq: 1, withoutFq: 1 });
  assert.deepEqual(s.regimeCoverage, { withRegime: 1, withoutRegime: 1 });
  // the null-feature row lands in the "unknown" cell, not a fabricated band
  assert.equal(s.byFlowQualityBand["unknown"]!.n, 1);
  assert.equal(s.byRegimeStructure["unknown"]!.n, 1);
});

test("summarizeFeatureStore: mean-EV read accumulates only rows that recorded a realized P&L", () => {
  const rows = [gr("win", {}, 100), gr("loss", {}, -50), gr("win", {}, null)];
  const s = summarizeFeatureStore(rows);
  assert.equal(s.overall.pnlN, 2);
  assert.equal(s.overall.pnlSum, 50);
});

test("bands: boundaries land where the tiers say", () => {
  assert.equal(scoreBand(85), "85+");
  assert.equal(scoreBand(84), "75-84");
  assert.equal(scoreBand(64), "<65");
  assert.equal(scoreBand(null), "unknown");
  assert.equal(flowQualityBand(75), "strong");
  assert.equal(flowQualityBand(50), "solid");
  assert.equal(flowQualityBand(24), "poor");
  assert.equal(flowQualityBand(null), "unknown");
});
