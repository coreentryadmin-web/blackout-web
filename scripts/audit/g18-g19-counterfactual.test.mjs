import { test } from "node:test";
import assert from "node:assert/strict";
import { pickGateLines, buildReport, parseCalibrationResponse } from "./g18-g19-counterfactual.mjs";

test("pickGateLines extracts G-18 and G-19", () => {
  const blocked = [
    { gate_failed: "tape_alignment", n: 10, would_have_won: 2, would_have_won_rate_pct: 20 },
    { gate_failed: "early_window_prime_score", n: 8, would_have_won: 2, would_have_won_rate_pct: 25, ungradeable: 1 },
    { gate_failed: "score_top_band", n: 5, would_have_won: 1, would_have_won_rate_pct: 20, ungradeable: 0 },
  ];
  const picked = pickGateLines(blocked);
  assert.equal(picked.early_window_prime_score.n, 8);
  assert.equal(picked.score_top_band.n, 5);
});

test("parseCalibrationResponse tolerates available:false", () => {
  const r = parseCalibrationResponse({ ok: true }, { available: false, reason: "no graded rows" });
  assert.equal(r.error, "no graded rows");
  assert.equal(r.report.available, false);
});

test("buildReport marks ok false when calibration error", () => {
  const report = buildReport({ calibration: null, replay: null, calibrationError: "empty window" });
  assert.equal(report.ok, false);
  assert.equal(report.calibration_error, "empty window");
});

test("buildReport adds verdict strings", () => {
  const report = buildReport({
    calibration: {
      window: { since: "2026-08-01", through: "2026-09-04", days: 14 },
      blocked_value: [
        { gate_failed: "early_window_prime_score", n: 12, would_have_won: 3, would_have_won_rate_pct: 25, ungradeable: 0 },
        { gate_failed: "score_top_band", n: 6, would_have_won: 1, would_have_won_rate_pct: 16.7, ungradeable: 0 },
      ],
      graded_plays: 40,
    },
    replay: { ok: true, replayed: 6, avg_replay_exec_pnl_pct: 10.7, win_rate_pct: 66.7 },
  });
  assert.equal(report.ok, true);
  assert.match(report.gates.early_window_prime_score.verdict, /KEEP|HOLD|REVIEW/);
  assert.equal(report.replay.replayed, 6);
});
