import test from "node:test";
import assert from "node:assert/strict";
import { targetReachabilityScenarios, isTargetPlausible } from "./early-entry-target-reachability.ts";
import { blackScholesEstimate } from "./early-entry-value-scenarios.ts";

test("targetReachabilityScenarios: null without a real iv -- never fabricated", () => {
  assert.equal(targetReachabilityScenarios({ spot: 100, strike: 105, side: "call", iv: null, minutesRemaining: 120, targetPremium: 10 }), null);
});

test("targetReachabilityScenarios: a call's solved required spot actually reproduces the target under blackScholesEstimate", () => {
  const r = targetReachabilityScenarios({ spot: 100, strike: 105, side: "call", iv: 0.6, minutesRemaining: 180, targetPremium: 10 });
  assert.ok(r);
  const now = r!.scenarios.find((s) => s.scenario === "now")!;
  assert.equal(now.reachable, true);
  assert.ok(now.required_underlying_price! > 100);
  const reproduced = blackScholesEstimate({ spot: now.required_underlying_price!, strike: 105, side: "call", iv: 0.6, minutesRemaining: 180 });
  assert.ok(Math.abs(reproduced! - 10) < 0.05);
});

test("targetReachabilityScenarios: a put's target >= strike is structurally IMPOSSIBLE, never a huge/undefined move", () => {
  const r = targetReachabilityScenarios({ spot: 100, strike: 8, side: "put", iv: 0.6, minutesRemaining: 180, targetPremium: 10 });
  assert.ok(r);
  for (const s of r!.scenarios) {
    assert.equal(s.impossible, true);
    assert.equal(s.reachable, false);
    assert.equal(s.required_underlying_price, null);
  }
});

test("targetReachabilityScenarios: a put's target below strike is solvable, requires a DOWN move", () => {
  const r = targetReachabilityScenarios({ spot: 100, strike: 95, side: "put", iv: 0.6, minutesRemaining: 180, targetPremium: 10 });
  assert.ok(r);
  const now = r!.scenarios.find((s) => s.scenario === "now")!;
  assert.equal(now.reachable, true);
  assert.ok(now.required_underlying_price! < 100);
  assert.ok(now.required_move_pct! < 0);
  const reproduced = blackScholesEstimate({ spot: now.required_underlying_price!, strike: 95, side: "put", iv: 0.6, minutesRemaining: 180 });
  assert.ok(Math.abs(reproduced! - 10) < 0.05);
});

// Deep-ITM targets (the earlier 105-strike/$10-target case) plateau toward the pure intrinsic
// answer, where extrinsic value -- and therefore the time/IV effect on required spot -- is
// negligible at this solver's 1-cent precision. An ATM-ish, modest target makes the extrinsic
// contribution (and therefore the decay/vol-shock effect) clearly non-negligible instead.
test("targetReachabilityScenarios: decayed (half the time) requires a LARGER move than now (same iv)", () => {
  const r = targetReachabilityScenarios({ spot: 100, strike: 100, side: "call", iv: 0.5, minutesRemaining: 120, targetPremium: 3 });
  assert.ok(r);
  const now = r!.scenarios.find((s) => s.scenario === "now")!;
  const decayed = r!.scenarios.find((s) => s.scenario === "decayed")!;
  assert.ok(decayed.required_move_pct! > now.required_move_pct!);
});

test("targetReachabilityScenarios: vol_shock (IV x1.5) requires a SMALLER move than now (same time)", () => {
  const r = targetReachabilityScenarios({ spot: 100, strike: 100, side: "call", iv: 0.5, minutesRemaining: 120, targetPremium: 3 });
  assert.ok(r);
  const now = r!.scenarios.find((s) => s.scenario === "now")!;
  const shock = r!.scenarios.find((s) => s.scenario === "vol_shock")!;
  assert.ok(shock.required_move_pct! < now.required_move_pct!);
});

test("isTargetPlausible: true when no real iv was available (never reject from a missing input)", () => {
  assert.equal(isTargetPlausible(null), true);
});

test("isTargetPlausible: false for a structurally impossible put target", () => {
  const r = targetReachabilityScenarios({ spot: 100, strike: 8, side: "put", iv: 0.6, minutesRemaining: 180, targetPremium: 10 });
  assert.equal(isTargetPlausible(r), false);
});

test("isTargetPlausible: true for a close, easily-reachable target; false for a wildly-implausible one", () => {
  const close = targetReachabilityScenarios({ spot: 100, strike: 100, side: "call", iv: 0.6, minutesRemaining: 300, targetPremium: 3 });
  assert.equal(isTargetPlausible(close), true);
  const farFetched = targetReachabilityScenarios({ spot: 100, strike: 100, side: "call", iv: 0.15, minutesRemaining: 15, targetPremium: 20 });
  assert.equal(isTargetPlausible(farFetched), false);
});
