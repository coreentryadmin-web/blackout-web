import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveChasePct,
  isAmplifyMomentumRegime,
  planChaseExempt,
  regimeExemptsPlanChase,
} from "./chase-exempt";

const amplifyCtx = {
  direction: "long" as const,
  score: 88,
  discovery_origin: ["FLOW"] as const,
  gamma_regime: "short_gamma",
  market_aligned: true,
  regime_structure: "TREND_UP",
  market_state_confidence: 0.85,
  vector_pulse: null,
};

test("isAmplifyMomentumRegime: short_gamma gamma_regime", () => {
  assert.equal(isAmplifyMomentumRegime({ ...amplifyCtx, gamma_regime: "short_gamma" }), true);
});

test("effectiveChasePct: amplify session uses higher band", () => {
  const prev = process.env.ZERODTE_AMPLIFY_CHASE_EXEMPT;
  delete process.env.ZERODTE_AMPLIFY_CHASE_EXEMPT;
  assert.equal(effectiveChasePct(amplifyCtx), 75);
  if (prev !== undefined) process.env.ZERODTE_AMPLIFY_CHASE_EXEMPT = prev;
});

test("regimeExemptsPlanChase: FLOW 85+ aligned on amplify", () => {
  assert.equal(regimeExemptsPlanChase(amplifyCtx), true);
});

test("regimeExemptsPlanChase: sub-85 score does not exempt", () => {
  assert.equal(regimeExemptsPlanChase({ ...amplifyCtx, score: 82 }), false);
});

test("planChaseExempt: Vector winner OR regime amplify", () => {
  assert.equal(planChaseExempt(amplifyCtx), true);
  assert.equal(
    planChaseExempt({
      ...amplifyCtx,
      gamma_regime: "long_gamma",
      market_aligned: false,
      vector_pulse: {
        premium_pct: 60,
        peak_premium_pct: 70,
        action_status: "still_buy",
        is_winner: true,
        is_runner: false,
        side: "call",
        direction: "long",
        strike: 100,
        occ: "X",
        rank: 1,
        role: "flow",
      },
    }),
    true
  );
});
