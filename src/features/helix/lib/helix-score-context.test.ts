import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  helixScoreContextForPrint,
  helixScoreContextHint,
  helixScoreDistribution,
  helixScorePercentile,
} from "./helix-score-context";

describe("helix-score-context", () => {
  test("helixScoreDistribution filters and sorts", () => {
    assert.deepEqual(helixScoreDistribution([0, 50, 20, NaN, 80]), [20, 50, 80]);
  });

  test("helixScorePercentile mid-rank for ties", () => {
    const dist = [20, 40, 40, 60, 80, 80, 80, 90];
    const p40 = helixScorePercentile(40, dist);
    assert.ok(p40 != null && p40 >= 20 && p40 <= 40);
    const p80 = helixScorePercentile(80, dist);
    assert.ok(p80 != null && p80 >= 65);
  });

  test("helixScoreContextForPrint calibrates with enough samples", () => {
    const dist = helixScoreDistribution([12, 25, 30, 45, 55, 60, 72, 88, 90, 95]);
    const top = helixScoreContextForPrint(95, dist);
    assert.equal(top.calibrationStatus, "session");
    assert.equal(top.tier, "rare");
    assert.ok(top.percentile != null && top.percentile >= 85);

    const mid = helixScoreContextForPrint(45, dist);
    assert.equal(mid.tier, "common");
  });

  test("helixScoreContextForPrint uncalibrated when sample thin", () => {
    const ctx = helixScoreContextForPrint(88, [20, 40, 60]);
    assert.equal(ctx.calibrationStatus, "uncalibrated");
    assert.equal(ctx.percentile, null);
    assert.equal(ctx.tier, "rare");
  });

  test("helixScoreContextHint mentions session percentile when calibrated", () => {
    const dist = helixScoreDistribution([12, 25, 30, 45, 55, 60, 72, 88, 90, 95]);
    const ctx = helixScoreContextForPrint(95, dist);
    const hint = helixScoreContextHint(ctx, 95);
    assert.match(hint, /Session:/);
    assert.match(hint, /Not a validated directional rank/);
  });
});
