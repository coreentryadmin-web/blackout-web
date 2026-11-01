import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySetupType,
  setupTypeInputFromScored,
  SETUP_TYPE_BALANCED_MARGIN,
} from "./setup-classification";
import type { ScoredCandidate } from "./scorer";

function scored(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    ticker: "TEST",
    score: 50,
    direction: "long",
    flow_score: 10,
    tech_score: 10,
    pos_score: 10,
    news_score: 10,
    smart_money_score: 10,
    conviction: "B",
    ...overrides,
  };
}

test("classifySetupType: labels by the strictly dominant dimension", () => {
  assert.equal(classifySetupType({ flow: 20, tech: 5, positioning: 2 }), "flow_led");
  assert.equal(classifySetupType({ flow: 5, tech: 20, positioning: 2 }), "technical_led");
  assert.equal(classifySetupType({ flow: 5, tech: 2, positioning: 20 }), "positioning_led");
  assert.equal(classifySetupType({ smart_money: 20, flow: 2 }), "smart_money_led");
  assert.equal(classifySetupType({ news: 20, flow: 2 }), "catalyst_or_news_led");
});

test("classifySetupType: 'balanced' when the top two are within SETUP_TYPE_BALANCED_MARGIN", () => {
  assert.equal(classifySetupType({ flow: 10, tech: 10 + SETUP_TYPE_BALANCED_MARGIN }), "balanced");
  assert.equal(classifySetupType({ flow: 10, tech: 10 + SETUP_TYPE_BALANCED_MARGIN + 1 }), "technical_led");
});

test("classifySetupType: 'unknown' when no dimension value is present at all", () => {
  assert.equal(classifySetupType({}), "unknown");
});

test("classifySetupType: null/undefined dimension values are excluded, not treated as 0", () => {
  // flow=null and tech=undefined should not compete with positioning; only positioning is real.
  assert.equal(classifySetupType({ flow: null, tech: undefined, positioning: 5 }), "positioning_led");
});

test("classifySetupType: non-finite values are excluded", () => {
  assert.equal(classifySetupType({ flow: NaN, positioning: 5 }), "positioning_led");
});

test("setupTypeInputFromScored: maps ScoredCandidate's real field names to the shared input shape", () => {
  const input = setupTypeInputFromScored(scored({ flow_score: 30, tech_score: 1, pos_score: 2, smart_money_score: 3, news_score: 4 }));
  assert.deepEqual(input, { flow: 30, tech: 1, positioning: 2, smart_money: 3, news: 4 });
  assert.equal(classifySetupType(input), "flow_led");
});

test("classifySetupType is order-independent -- the same set of scores always yields the same label regardless of key insertion order", () => {
  const a = classifySetupType({ tech: 5, flow: 20 });
  const b = classifySetupType({ flow: 20, tech: 5 });
  assert.equal(a, b);
  assert.equal(a, "flow_led");
});
