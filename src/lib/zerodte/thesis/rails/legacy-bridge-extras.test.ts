import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyBridgeExtrasFromSetup } from "./legacy-bridge";
import type { EnrichedZeroDteSetup } from "../../board";

function setup(overrides: Partial<EnrichedZeroDteSetup> = {}): EnrichedZeroDteSetup {
  return {
    ticker: "SNAP",
    direction: "short",
    play_type: "DIRECTIONAL",
    discovery_origin: ["BREAKOUT"],
    top_strike: 5.5,
    expiry: "2026-08-28",
    dte: 2,
    contract_horizon: "WEEKLY_FALLBACK",
    actual_dte_at_commit: 2,
    grading_policy: "same_day",
    net_premium: 0,
    gross_premium: 0,
    prints: 0,
    sweep_pct: 0,
    side_dominance: 0.5,
    underlying_price: 5.56,
    underlying_price_as_of: null,
    underlying_price_source: null,
    score: 65,
    dossier_score: 65,
    conviction: null,
    direction_confirmed: null,
    factor_breakdown: null,
    trend: null,
    tech_tags: [],
    breakout_zones: [],
    key_supports: [5.2],
    key_resistances: [5.8],
    vwap: null,
    atr14: null,
    rsi14: null,
    rel_volume: 2.1,
    streak_days: null,
    dark_pool_bias: null,
    gex_king_strike: 5.5,
    gamma_regime: "long_gamma",
    intraday: null,
    intraday_conflict: false,
    flow_quality: null,
    ...overrides,
  } as EnrichedZeroDteSetup;
}

test("legacyBridgeExtrasFromSetup maps gamma walls and chart levels", () => {
  const extras = legacyBridgeExtrasFromSetup(setup());
  assert.equal(extras.gamma_posture, "long");
  assert.equal(extras.call_wall, 5.8);
  assert.equal(extras.put_wall, 5.2);
  assert.equal(extras.resistance, 5.8);
});
