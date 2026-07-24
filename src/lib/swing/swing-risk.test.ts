import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSwingRisk, type SwingRiskPosition } from "./swing-risk.ts";

const base: SwingRiskPosition = {
  ticker: "NVDA",
  direction: "LONG",
  contracts: 10,
  contractMultiplier: 100,
  greeks: { delta: 0.6, gamma: 0.02, theta: -0.15, vega: 0.3 },
  underlyingPrice: 100,
  premiumPerShare: 5,
  beta: 1.5,
  betaMissing: false,
};

test("full inputs → all risk fields grounded, not partial", () => {
  const r = computeSwingRisk(base);
  assert.equal(r.partial, false);
  assert.deepEqual(r.missing, []);
  // position-scaled greeks: per-contract × 10 × 100 × sign(+1)
  assert.equal(r.greekRisk.delta, 0.6 * 10 * 100);
  assert.equal(r.greekRisk.gamma, 0.02 * 10 * 100);
  assert.equal(r.greekRisk.theta, -0.15 * 10 * 100);
  assert.equal(r.greekRisk.vega, 0.3 * 10 * 100);
  // dollar capital at risk = |premium| × mult × contracts
  assert.equal(r.dollarRisk, 5 * 100 * 10);
  // beta-weighted DOLLAR delta = (delta·qty·mult·sign·spot) × beta
  assert.equal(r.betaWeightedDelta, 0.6 * 10 * 100 * 100 * 1.5);
});

test("SHORT flips the sign of every greek and of beta-weighted delta", () => {
  const r = computeSwingRisk({ ...base, direction: "SHORT" });
  assert.equal(r.greekRisk.delta, -(0.6 * 10 * 100));
  assert.equal(r.greekRisk.theta, -(-0.15 * 10 * 100)); // short a long-theta-negative option → +theta
  assert.equal(r.betaWeightedDelta, -(0.6 * 10 * 100 * 100 * 1.5));
  // dollarRisk stays a positive magnitude (capital deployed, not a signed P&L)
  assert.equal(r.dollarRisk, 5 * 100 * 10);
});

test("greeksMissing → partial + null sub-field, never a fabricated 0", () => {
  const r = computeSwingRisk({ ...base, greeks: { delta: null, gamma: 0.02, theta: -0.15, vega: 0.3 } });
  assert.equal(r.partial, true);
  assert.equal(r.greekRisk.delta, null); // NOT 0
  assert.ok(r.missing.includes("greeks.delta"));
  // delta missing propagates → beta-weighted delta can't be formed
  assert.equal(r.betaWeightedDelta, null);
  // the greeks that WERE present still compute
  assert.equal(r.greekRisk.gamma, 0.02 * 10 * 100);
});

test("betaMissing → partial + null beta-weighted delta, other risk still grounded", () => {
  const r = computeSwingRisk({ ...base, beta: null, betaMissing: true });
  assert.equal(r.partial, true);
  assert.ok(r.missing.includes("beta"));
  assert.equal(r.betaWeightedDelta, null);
  // greeks + dollar risk are unaffected by a missing beta
  assert.equal(r.greekRisk.delta, 0.6 * 10 * 100);
  assert.equal(r.dollarRisk, 5000);
});

test("absent spot and premium each mark partial and null their dependents", () => {
  const r = computeSwingRisk({ ...base, underlyingPrice: null, premiumPerShare: null });
  assert.equal(r.partial, true);
  assert.ok(r.missing.includes("underlyingPrice"));
  assert.ok(r.missing.includes("premiumPerShare"));
  assert.equal(r.dollarRisk, null); // NOT 0
  assert.equal(r.betaWeightedDelta, null); // spot missing → can't form dollar delta
});

test("betaMissing inferred from a null beta even without the explicit flag", () => {
  const r = computeSwingRisk({ ...base, beta: null, betaMissing: undefined });
  assert.equal(r.betaWeightedDelta, null);
  assert.ok(r.missing.includes("beta"));
});
