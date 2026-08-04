import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RAIL_GRADUATION_MIN_DELTA_PTS,
  RAIL_GRADUATION_MIN_N,
  buildRailGraduationReport,
  readRegStructureFromRow,
  recommendRailGraduation,
} from "./calibration-rail-graduation";
import { bucketOf } from "./calibration";

describe("calibration-rail-graduation", () => {
  it("readRegStructureFromRow reads feature_vector.reg_structure", () => {
    assert.equal(
      readRegStructureFromRow({
        session_date: "2026-08-01",
        ticker: "NVDA",
        direction: "long",
        score_max: 70,
        plan_outcome: "doubled",
        plan_pnl_pct: 100,
        entry_context: null,
        gate_calibration_json: null,
        feature_vector: { reg_structure: "TREND_UP" },
      }),
      "TREND_UP"
    );
    assert.equal(
      readRegStructureFromRow({
        session_date: "2026-08-01",
        ticker: "NVDA",
        direction: "long",
        score_max: 70,
        plan_outcome: "doubled",
        plan_pnl_pct: 100,
        entry_context: null,
        gate_calibration_json: null,
        feature_vector: null,
      }),
      "unknown"
    );
  });

  it("recommendRailGraduation enforces at n>=30 and +5pp delta", () => {
    const bucket = bucketOf(
      "FLOW",
      Array.from({ length: 30 }, () => ({
        session_date: "2026-08-01",
        ticker: "NVDA",
        direction: "long" as const,
        score_max: 70,
        plan_outcome: "doubled" as const,
        plan_pnl_pct: 100,
        entry_context: { discovery_origin: ["FLOW"] },
        gate_calibration_json: null,
      }))
    );
    const rec = recommendRailGraduation("FLOW", bucket, 50);
    assert.equal(rec.verdict, "ready_to_enforce");
    assert.ok((rec.delta_win_rate_pts ?? 0) >= RAIL_GRADUATION_MIN_DELTA_PTS);
  });

  it("recommendRailGraduation insufficient below min n", () => {
    const bucket = bucketOf("BREAKOUT", []);
    const rec = recommendRailGraduation("BREAKOUT", bucket, 50);
    assert.equal(rec.verdict, "insufficient_data");
    assert.equal(rec.n, 0);
  });

  it("FIREWALL: graduation constants pinned", () => {
    assert.equal(RAIL_GRADUATION_MIN_N, 30);
    assert.equal(RAIL_GRADUATION_MIN_DELTA_PTS, 5);
  });

  it("buildRailGraduationReport includes origin×regime cells", () => {
    const rows = [
      {
        session_date: "2026-08-01",
        ticker: "NVDA",
        direction: "long" as const,
        score_max: 72,
        plan_outcome: "doubled" as const,
        plan_pnl_pct: 80,
        entry_context: { discovery_origin: ["FLOW"] },
        gate_calibration_json: null,
        feature_vector: { reg_structure: "TREND_UP" },
      },
    ];
    const snap = buildRailGraduationReport({
      rows,
      window: { since: "2026-07-01", through: "2026-08-01", days: 30 },
      nowIso: "2026-08-01T21:00:00.000Z",
      priorsMode: "shadow",
    });
    assert.equal(snap.graded_plays, 1);
    assert.ok(snap.origin_regime_cells.some((c) => c.origin === "FLOW" && c.reg_structure === "TREND_UP"));
    assert.equal(snap.rails.length, 3);
  });
});
