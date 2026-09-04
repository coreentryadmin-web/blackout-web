import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveIlliquidSpreadPct,
  regimeBypassesThesisBlocks,
  regimeScoreBump,
  regimeThesisArchetypeRelief,
  PLAN_ILLIQUID_SPREAD_PCT_AMPLIFY,
} from "./regime-commit-relief";
import { PLAN_ILLIQUID_SPREAD_PCT } from "./plan";
import type { PlanChaseContext } from "./chase-exempt";

const amplifyCtx: PlanChaseContext = {
  direction: "long",
  score: 88,
  discovery_origin: ["FLOW"],
  gamma_regime: "short_gamma",
  market_aligned: true,
  regime_structure: "TREND_UP",
  market_state_confidence: 0.85,
  vector_pulse: null,
};

test("effectiveIlliquidSpreadPct: amplify session widens cap to 22%", () => {
  const prev = process.env.ZERODTE_AMPLIFY_ILLIQUID_RELIEF;
  delete process.env.ZERODTE_AMPLIFY_ILLIQUID_RELIEF;
  assert.equal(effectiveIlliquidSpreadPct(amplifyCtx), PLAN_ILLIQUID_SPREAD_PCT_AMPLIFY);
  assert.equal(
    effectiveIlliquidSpreadPct({
      ...amplifyCtx,
      gamma_regime: "long_gamma",
      regime_structure: "RANGE",
      market_state_confidence: 0.5,
    }),
    PLAN_ILLIQUID_SPREAD_PCT
  );
  if (prev !== undefined) process.env.ZERODTE_AMPLIFY_ILLIQUID_RELIEF = prev;
});

test("regimeScoreBump: near-miss 58-64 on aligned amplify FLOW", () => {
  const prev = process.env.ZERODTE_AMPLIFY_SCORE_BUMP;
  delete process.env.ZERODTE_AMPLIFY_SCORE_BUMP;
  assert.equal(regimeScoreBump({ ...amplifyCtx, score: 62 }), 6);
  assert.equal(regimeScoreBump({ ...amplifyCtx, score: 65 }), 0);
  assert.equal(regimeScoreBump({ ...amplifyCtx, score: 57 }), 0);
  assert.equal(regimeScoreBump({ ...amplifyCtx, score: 62, market_aligned: false }), 0);
  if (prev !== undefined) process.env.ZERODTE_AMPLIFY_SCORE_BUMP = prev;
});

test("regimeBypassesThesisBlocks: FLOW/BREAKOUT 80+ aligned on amplify", () => {
  const prev = process.env.ZERODTE_AMPLIFY_THESIS_BYPASS;
  delete process.env.ZERODTE_AMPLIFY_THESIS_BYPASS;
  assert.equal(regimeBypassesThesisBlocks({ ...amplifyCtx, score: 84 }), true);
  assert.equal(regimeBypassesThesisBlocks({ ...amplifyCtx, score: 79 }), false);
  assert.equal(
    regimeBypassesThesisBlocks({ ...amplifyCtx, score: 90, discovery_origin: ["BREAKOUT"] }),
    true
  );
  if (prev !== undefined) process.env.ZERODTE_AMPLIFY_THESIS_BYPASS = prev;
});

test("regimeThesisArchetypeRelief: aligned FLOW/BREAKOUT 75+ on amplify", () => {
  const prev = process.env.ZERODTE_AMPLIFY_THESIS_ARCHETYPE_RELIEF;
  delete process.env.ZERODTE_AMPLIFY_THESIS_ARCHETYPE_RELIEF;
  assert.equal(regimeThesisArchetypeRelief({ ...amplifyCtx, score: 78 }), true);
  assert.equal(
    regimeThesisArchetypeRelief({ ...amplifyCtx, score: 88, discovery_origin: ["BREAKOUT"] }),
    true
  );
  assert.equal(regimeThesisArchetypeRelief({ ...amplifyCtx, score: 70 }), false);
  if (prev !== undefined) process.env.ZERODTE_AMPLIFY_THESIS_ARCHETYPE_RELIEF = prev;
});
