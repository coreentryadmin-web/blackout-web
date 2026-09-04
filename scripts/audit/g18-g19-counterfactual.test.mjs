import { test } from "node:test";
import assert from "node:assert/strict";
import { pickGateLines, buildReport } from "./g18-g19-counterfactual.mjs";

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

test("buildReport handles empty calibration window with INSUFFICIENT_DATA verdicts", () => {
  const report = buildReport({
    calibration: {
      available: false,
      window: { since: "2026-08-27", through: "2026-09-03", days: 7 },
      blocked_value: [],
      graded_plays: 0,
    },
    replay: null,
  });
  assert.equal(report.ok, true);
  assert.match(report.gates.early_window_prime_score.verdict, /INSUFFICIENT_DATA/);
  assert.match(report.gates.score_top_band.verdict, /INSUFFICIENT_DATA/);
});
