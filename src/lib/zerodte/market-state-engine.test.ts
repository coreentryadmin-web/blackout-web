import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMarketState,
  rawRailWeightsForStructure,
  weightedScoreForMerge,
} from "./market-state-engine";
import type { MarketRegime } from "./regime";

const trendRegime: MarketRegime = {
  structure: "TREND_UP",
  gap: "FLAT",
  vol: "NORMAL_IV",
  calendar: { opex: false, quarterlyOpex: false, fedDay: false, monthEnd: false, quarterEnd: false },
  tags: [],
  label: "trend up",
};

describe("market-state-engine", () => {
  it("trend day boosts FLOW/BREAKOUT and cuts PIN", () => {
    const raw = rawRailWeightsForStructure("TREND_UP");
    assert.ok(raw.FLOW > 1);
    assert.ok(raw.BREAKOUT > 1);
    assert.ok(raw.PIN < 1);
  });

  it("range day boosts PIN and cuts BREAKOUT", () => {
    const raw = rawRailWeightsForStructure("RANGE");
    assert.ok(raw.PIN > 1);
    assert.ok(raw.BREAKOUT < 1);
  });

  it("buildMarketState blends weights by confidence", () => {
    const state = buildMarketState({ regime: trendRegime, sessionDate: "2026-08-03" });
    assert.ok(state.confidence >= 0.7);
    assert.ok(state.rail_weights.FLOW > 1);
    assert.ok(state.rail_weights.PIN < 1);
  });

  it("blendRegimeWithCalibrationPriors mixes shadow weights", () => {
    const state = buildMarketState({
      regime: trendRegime,
      sessionDate: "2026-08-03",
      shadowCalibration: {
        rail_weights: { FLOW: 0.8, BREAKOUT: 1.3, PIN: 1.1 },
        confidence: 1,
        blend: 0.5,
      },
    });
    assert.ok(state.calibration_shadow?.active);
    assert.ok(state.rail_weights.BREAKOUT > 1.1);
  });

  it("weightedScoreForMerge uses max origin weight", () => {
    const state = buildMarketState({ regime: trendRegime, sessionDate: "2026-08-03" });
    const both = weightedScoreForMerge(70, ["FLOW", "BREAKOUT"], state);
    assert.ok(both > 70);
  });
});
