import test from "node:test";
import assert from "node:assert/strict";
import { blackScholesEstimate, estimateContractValueScenarios } from "./early-entry-value-scenarios.ts";

test("blackScholesEstimate: a call's value rises as spot rises toward/through the strike", () => {
  const low = blackScholesEstimate({ spot: 98, strike: 100, side: "call", iv: 0.4, minutesRemaining: 120 })!;
  const atm = blackScholesEstimate({ spot: 100, strike: 100, side: "call", iv: 0.4, minutesRemaining: 120 })!;
  const high = blackScholesEstimate({ spot: 104, strike: 100, side: "call", iv: 0.4, minutesRemaining: 120 })!;
  assert.ok(low < atm && atm < high, `expected low < atm < high, got ${low} ${atm} ${high}`);
});

test("blackScholesEstimate: a put's value rises as spot falls toward/through the strike", () => {
  const high = blackScholesEstimate({ spot: 104, strike: 100, side: "put", iv: 0.4, minutesRemaining: 120 })!;
  const atm = blackScholesEstimate({ spot: 100, strike: 100, side: "put", iv: 0.4, minutesRemaining: 120 })!;
  const low = blackScholesEstimate({ spot: 96, strike: 100, side: "put", iv: 0.4, minutesRemaining: 120 })!;
  assert.ok(high < atm && atm < low, `expected high < atm < low, got ${high} ${atm} ${low}`);
});

test("blackScholesEstimate: at minutesRemaining<=0, the value is exactly the intrinsic value", () => {
  const callItm = blackScholesEstimate({ spot: 105, strike: 100, side: "call", iv: 0.4, minutesRemaining: 0 });
  assert.equal(callItm, 5);
  const callOtm = blackScholesEstimate({ spot: 95, strike: 100, side: "call", iv: 0.4, minutesRemaining: 0 });
  assert.equal(callOtm, 0);
  const putItm = blackScholesEstimate({ spot: 95, strike: 100, side: "put", iv: 0.4, minutesRemaining: -5 });
  assert.equal(putItm, 5);
});

test("blackScholesEstimate: higher IV raises value for an OTM contract with time left", () => {
  const lowIv = blackScholesEstimate({ spot: 100, strike: 105, side: "call", iv: 0.2, minutesRemaining: 120 })!;
  const highIv = blackScholesEstimate({ spot: 100, strike: 105, side: "call", iv: 0.6, minutesRemaining: 120 })!;
  assert.ok(highIv > lowIv);
});

test("blackScholesEstimate: missing or non-positive iv returns null, never fabricated, when time remains", () => {
  assert.equal(blackScholesEstimate({ spot: 100, strike: 105, side: "call", iv: null, minutesRemaining: 120 }), null);
  assert.equal(blackScholesEstimate({ spot: 100, strike: 105, side: "call", iv: 0, minutesRemaining: 120 }), null);
});

test("blackScholesEstimate: a non-positive spot or strike returns null", () => {
  assert.equal(blackScholesEstimate({ spot: 0, strike: 105, side: "call", iv: 0.3, minutesRemaining: 120 }), null);
  assert.equal(blackScholesEstimate({ spot: 100, strike: 0, side: "call", iv: 0.3, minutesRemaining: 120 }), null);
});

test("estimateContractValueScenarios: returns null when iv is missing -- never a fabricated grid", () => {
  const r = estimateContractValueScenarios({ spot: 100, strike: 105, side: "call", iv: null, minutesRemaining: 120 });
  assert.equal(r, null);
});

test("estimateContractValueScenarios: the base_value matches a direct blackScholesEstimate call", () => {
  const r = estimateContractValueScenarios({ spot: 100, strike: 105, side: "call", iv: 0.4, minutesRemaining: 120 });
  const direct = blackScholesEstimate({ spot: 100, strike: 105, side: "call", iv: 0.4, minutesRemaining: 120 });
  assert.equal(r?.base_value, direct);
});

test("estimateContractValueScenarios: every point is labeled is_estimate:true, and the three tables cover their own axis monotonically", () => {
  const r = estimateContractValueScenarios({ spot: 100, strike: 105, side: "call", iv: 0.4, minutesRemaining: 120 })!;
  assert.ok(r.by_underlying_price.length >= 3);
  assert.ok(r.by_elapsed_time.length >= 3);
  assert.ok(r.by_volatility.length >= 3);
  for (const table of [r.by_underlying_price, r.by_elapsed_time, r.by_volatility]) {
    for (const p of table) assert.equal(p.is_estimate, true);
  }
  // by_underlying_price: current < +0.5x < +1x < +1.5x (all ascending spot moves toward an OTM call's strike)
  const up = r.by_underlying_price;
  assert.ok(up[0]!.estimated_value <= up[1]!.estimated_value);
  assert.ok(up[1]!.estimated_value <= up[2]!.estimated_value);
  assert.ok(up[2]!.estimated_value <= up[3]!.estimated_value);
  // by_volatility: current IV < +20% < +50% (higher vol = more value for an OTM option)
  const vol = r.by_volatility;
  const byLabel = new Map(vol.map((p) => [p.label, p.estimated_value]));
  assert.ok(byLabel.get("current IV")! < byLabel.get("IV +20%")!);
  assert.ok(byLabel.get("IV +20%")! < byLabel.get("IV +50% (vol shock)")!);
});

test("estimateContractValueScenarios: by_elapsed_time's 'near the time-stop' value is never negative and stays well-formed as time shrinks", () => {
  const r = estimateContractValueScenarios({ spot: 100, strike: 105, side: "call", iv: 0.4, minutesRemaining: 120 })!;
  for (const p of r.by_elapsed_time) assert.ok(p.estimated_value >= 0);
});

test("estimateContractValueScenarios: works symmetrically for a put", () => {
  // A deep-OTM put (strike far below spot) with only 2 hours left genuinely rounds to ~0 real
  // extrinsic value -- that's correct Black-Scholes behavior, not a bug, so this uses a strike
  // close enough to spot to carry real, non-zero extrinsic value worth asserting on.
  const r = estimateContractValueScenarios({ spot: 100, strike: 98, side: "put", iv: 0.4, minutesRemaining: 120 });
  assert.ok(r != null);
  assert.ok(r!.base_value > 0, `expected a real positive extrinsic value, got ${r!.base_value}`);
});
