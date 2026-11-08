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

  // Regression (round 408): a caller-supplied `minSamples` LOWER than the module default
  // (HELIX_SCORE_CALIBRATION_MIN_SAMPLES = 8) used to be silently ignored. `helixScorePercentile`
  // hard-coded the module constant as its own floor, so a 7-sample distribution — above the
  // caller's explicit minSamples=5, but below the hard-coded 8 — made `helixScorePercentile`
  // return `null`, which then tripped `helixScoreContextForPrint`'s `percentile == null` branch
  // and forced "uncalibrated" regardless of the caller's own, explicitly lower, floor.
  test("helixScoreContextForPrint honors a minSamples LOWER than the module default", () => {
    const dist = helixScoreDistribution([10, 20, 30, 40, 50, 60, 70]); // n=7, below the default of 8
    const ctx = helixScoreContextForPrint(60, dist, 5);
    assert.equal(ctx.calibrationStatus, "session", "7 samples clears the caller's own floor of 5");
    assert.notEqual(ctx.percentile, null);
    assert.equal(ctx.sessionSampleSize, 7);
  });

  // Same bug, isolated at the lower-level helper directly (no intermediate caller logic).
  test("helixScorePercentile honors an explicit minSamples below its own default", () => {
    const dist = [10, 20, 30, 40, 50, 60, 70]; // n=7
    assert.equal(helixScorePercentile(60, dist), null, "below the module default of 8, no override");
    const withOverride = helixScorePercentile(60, dist, 5);
    assert.notEqual(withOverride, null, "n=7 clears an explicit minSamples=5");
  });

  // The higher-than-default direction already worked (the outer check in the caller catches it
  // too) — kept here as a control so this file can't regress to "never calibrates below 8" by a
  // different route.
  test("helixScoreContextForPrint still respects a minSamples HIGHER than the module default", () => {
    const dist = helixScoreDistribution([12, 25, 30, 45, 55, 60, 72, 88, 90]); // n=9
    const ctx = helixScoreContextForPrint(90, dist, 10);
    assert.equal(ctx.calibrationStatus, "uncalibrated", "9 samples does not clear a floor of 10");
  });

  test("helixScoreContextHint mentions session percentile when calibrated", () => {
    const dist = helixScoreDistribution([12, 25, 30, 45, 55, 60, 72, 88, 90, 95]);
    const ctx = helixScoreContextForPrint(95, dist);
    const hint = helixScoreContextHint(ctx, 95);
    assert.match(hint, /Session:/);
    assert.match(hint, /Not a validated directional rank/);
  });
});
