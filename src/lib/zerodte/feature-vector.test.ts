import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSetupFeatureVector,
  numericVector,
  NUMERIC_FEATURE_KEYS,
  CATEGORICAL_FEATURE_KEYS,
  FEATURE_VECTOR_VERSION,
  type SetupFeatureInputs,
} from "./feature-vector.ts";
import { computeFlowQuality, type FlowPrint } from "./flow-quality.ts";
import { classifyRegime } from "./regime.ts";

const T0 = Date.parse("2026-07-23T14:00:00Z");
function fp(over: Partial<FlowPrint>): FlowPrint {
  return { premiumUsd: 300_000, askPct: 74, isSweep: true, strike: 100, expiryYmd: "2026-07-23", side: "call", tsMs: T0, ...over };
}
const strongFlow = computeFlowQuality(Array.from({ length: 12 }, (_, i) => fp({ premiumUsd: 200_000 + i * 40_000, tsMs: T0 + i * 90_000 })));

// A quarterly-OPEX, elevated-IV trend-up day.
const trendRegime = classifyRegime({
  open: 600, last: 610, high: 611, low: 599, prevClose: 600, prevHigh: 602, prevLow: 596,
  vwap: 605, atr: 8, vwapCrosses: 1, vix: 18, dateYmd: "2026-06-19", isFedDay: true,
});

function inputs(over: Partial<SetupFeatureInputs> = {}): SetupFeatureInputs {
  return {
    ticker: "spy", direction: "long", etMinutes: 65, evidenceScore: 82, dossierScore: 74,
    flowQuality: strongFlow, regime: trendRegime,
    vwapDistPct: 0.4, orBreak: "above", trend5m: "up", rsi14: 58, relVolume: 2.4, atr14: 7.1,
    gammaRegime: "positive", gexKingDistPct: 1.2, darkPoolBias: "bullish",
    vix: 18, spyBias: "up", confluence: "double",
    ...over,
  };
}

test("stamps the schema version", () => {
  assert.equal(buildSetupFeatureVector(inputs()).v, FEATURE_VECTOR_VERSION);
});

test("flattens the flow-quality components + momentum verbatim", () => {
  const v = buildSetupFeatureVector(inputs());
  assert.equal(v.fq_score, strongFlow.score);
  assert.equal(v.fq_premium_depth, strongFlow.components.premiumDepth);
  assert.equal(v.fq_aggression, strongFlow.components.aggression);
  assert.equal(v.fq_momentum, strongFlow.components.momentum);
  assert.equal(v.fq_dominance, strongFlow.dominance);
  assert.equal(v.fq_accelerating, strongFlow.momentum.accelerating ? 1 : 0);
  assert.equal(v.fq_prem_per_min, strongFlow.momentum.premiumPerMin);
});

test("maps regime + its boolean calendar flags to 0/1", () => {
  const v = buildSetupFeatureVector(inputs());
  assert.equal(v.reg_structure, "TREND_UP");
  assert.equal(v.reg_vol, "ELEVATED_IV");
  assert.equal(v.reg_opex, 1); // June 19 2026 is a 3rd Friday
  assert.equal(v.reg_quad, 1); // ...of a quarterly month
  assert.equal(v.reg_fed, 1);
});

test("carries scores, technicals, positioning, and context", () => {
  const v = buildSetupFeatureVector(inputs());
  assert.equal(v.ticker, "SPY"); // upper-cased
  assert.equal(v.side, "long");
  assert.equal(v.tod_min, 65);
  assert.equal(v.evidence_score, 82);
  assert.equal(v.dossier_score, 74);
  assert.equal(v.vwap_dist_pct, 0.4);
  assert.equal(v.or_break, "above");
  assert.equal(v.rsi14, 58);
  assert.equal(v.gamma_regime, "positive");
  assert.equal(v.dark_pool_bias, "bullish");
  assert.equal(v.confluence, "double");
});

test("optional + non-finite fields degrade to null (not 0)", () => {
  const v = buildSetupFeatureVector(inputs({ dossierScore: null, rsi14: undefined, vwapDistPct: NaN, orBreak: null }));
  assert.equal(v.dossier_score, null);
  assert.equal(v.rsi14, null);
  assert.equal(v.vwap_dist_pct, null);
  assert.equal(v.or_break, null);
});

test("numericVector matches NUMERIC_FEATURE_KEYS order and preserves nulls", () => {
  const v = buildSetupFeatureVector(inputs({ rsi14: null }));
  const nv = numericVector(v);
  assert.equal(nv.length, NUMERIC_FEATURE_KEYS.length);
  const rsiIdx = NUMERIC_FEATURE_KEYS.indexOf("rsi14");
  assert.equal(nv[rsiIdx], null); // missing feature stays null, not 0
  const scoreIdx = NUMERIC_FEATURE_KEYS.indexOf("evidence_score");
  assert.equal(nv[scoreIdx], 82);
});

test("numeric and categorical key sets are disjoint", () => {
  const cat = new Set<string>(CATEGORICAL_FEATURE_KEYS);
  for (const k of NUMERIC_FEATURE_KEYS) assert.ok(!cat.has(k), `${k} is in both key sets`);
});

test("every numeric key resolves to a number or null on a full vector", () => {
  const v = buildSetupFeatureVector(inputs());
  for (const k of NUMERIC_FEATURE_KEYS) {
    const val = v[k];
    assert.ok(val === null || typeof val === "number", `${k} should be number|null, got ${typeof val}`);
  }
});
