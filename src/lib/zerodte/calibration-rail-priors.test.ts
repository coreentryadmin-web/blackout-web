import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeShadowRailPriorsFromOriginBands,
  winRateDeltaToRailWeight,
} from "./calibration-rail-priors";
import type { CalibrationBucket } from "./calibration";

function band(label: string, n: number, wins: number): CalibrationBucket {
  return {
    label,
    n,
    wins,
    losses: n - wins,
    win_rate_pct: n > 0 ? Math.round((wins / n) * 1000) / 10 : null,
    avg_pnl_pct: null,
    low_n: n < 5,
    win_rate_ci_pct: null,
  };
}

describe("calibration-rail-priors", () => {
  it("winRateDeltaToRailWeight scales positive delta up toward clamp", () => {
    const w = winRateDeltaToRailWeight(20, 1);
    assert.ok(w > 1.15);
    assert.ok(w <= 1.35);
  });

  it("computeShadowRailPriors boosts high-WR rail and cuts low-WR rail", () => {
    const bands = [band("FLOW", 10, 8), band("BREAKOUT", 10, 2), band("PIN", 6, 4)];
    const snap = computeShadowRailPriorsFromOriginBands(
      bands,
      { since: "2026-07-01", through: "2026-08-01", days: 30 },
      "2026-08-01T00:00:00.000Z"
    );
    assert.ok(snap.rail_weights.FLOW > snap.rail_weights.BREAKOUT);
    assert.ok(snap.confidence > 0);
  });
});
