import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeThesisRankCalibration, THESIS_RANK_CALIBRATION_MIN_N } from "./rank-calibration";

test("analyzeThesisRankCalibration buckets rank tiers and gates A+ on n", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    session_date: "2026-08-01",
    ticker: `T${i}`,
    direction: "long" as const,
    score_max: 80,
    plan_outcome: i % 2 === 0 ? "win" : "loss",
    plan_pnl_pct: i % 2 === 0 ? 50 : -50,
    entry_context: {
      thesis_first: {
        rank_tier: "A+",
        systems_aligned: 4,
        trade_archetype: "BREAKOUT",
        disagreeing_rails: [],
      },
    },
    gate_calibration_json: null,
  }));

  const report = analyzeThesisRankCalibration(rows);
  assert.equal(report.graded_with_thesis, 12);
  assert.equal(report.buckets.rank_tier[0]?.label, "A+");
  assert.equal(report.recommendations[0]?.verdict, "keep_calibrating");
  assert.match(report.recommendations[0]?.reason ?? "", new RegExp(String(THESIS_RANK_CALIBRATION_MIN_N)));
});

test("analyzeThesisRankCalibration ready_to_tune when A tier clears bar", () => {
  const watchRows = Array.from({ length: 20 }, (_, i) => ({
    session_date: "2026-08-02",
    ticker: `L${i}`,
    direction: "long" as const,
    score_max: 60,
    plan_outcome: i < 6 ? "win" : "loss",
    plan_pnl_pct: i < 6 ? 40 : -50,
    entry_context: {
      thesis_first: {
        rank_tier: "WATCH",
        systems_aligned: 1,
        trade_archetype: "MOMENTUM_CONTINUATION",
        disagreeing_rails: [],
      },
    },
    gate_calibration_json: null,
  }));
  const aRows = Array.from({ length: 35 }, (_, i) => ({
    session_date: "2026-08-02",
    ticker: `W${i}`,
    direction: "long" as const,
    score_max: 78,
    plan_outcome: i < 25 ? "win" : "loss",
    plan_pnl_pct: i < 25 ? 80 : -50,
    entry_context: {
      thesis_first: {
        rank_tier: "A",
        systems_aligned: 3,
        trade_archetype: "FLOW_FOLLOWING",
        disagreeing_rails: [],
      },
    },
    gate_calibration_json: null,
  }));

  const report = analyzeThesisRankCalibration([...watchRows, ...aRows]);
  const aRec = report.recommendations.find((r) => r.rank_tier === "A");
  assert.ok(aRec);
  assert.equal(aRec!.verdict, "ready_to_tune");
  assert.ok((aRec!.delta_win_rate_pts ?? 0) >= 10);
});
