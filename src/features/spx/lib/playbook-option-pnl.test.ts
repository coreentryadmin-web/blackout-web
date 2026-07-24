import test from "node:test";
import assert from "node:assert/strict";
import { parseOptionPremiumMid, buildGreeksSnapshot, estimateOptionPnl } from "./playbook-option-pnl";
import type { OptionGreeksSnapshot } from "./playbook-option-pnl";

test("parseOptionPremiumMid: extracts first number from range", () => {
  assert.equal(parseOptionPremiumMid("$2.50–$3.00"), 2.5);
  assert.equal(parseOptionPremiumMid(null), null);
});

test("buildGreeksSnapshot: marks synthetic gamma when chain omits it", () => {
  const greeks = buildGreeksSnapshot({
    direction: "long",
    entry_spot: 5400,
    option_mid: 2.5,
    delta: 0.4,
  });
  assert.ok(greeks.synthetic_fields.includes("gamma"));
  assert.ok(greeks.synthetic_fields.includes("iv"));
  assert.ok(greeks.synthetic_fields.includes("theta"));
});

test("estimateOptionPnl: modeled flag TRUE + lists fields when greeks were synthetic", () => {
  // Chain omitted delta/gamma/iv → snapshot pushes them into synthetic_fields (theta is
  // always model-derived). The est Δ$ must carry that provenance so the UI can badge it.
  const greeks = buildGreeksSnapshot({
    direction: "long",
    entry_spot: 5400,
    option_mid: 2.5,
    // no delta/gamma/iv → all synthetic
  });
  const pnl = estimateOptionPnl({ greeks, current_spot: 5410, minutes_held: 30 });
  assert.equal(pnl.modeled, true);
  assert.deepEqual([...pnl.modeled_fields].sort(), ["delta", "gamma", "iv", "theta"].sort());
});

test("estimateOptionPnl: modeled flag FALSE when every input is observed", () => {
  // A snapshot built entirely from observed chain values (empty synthetic_fields) must NOT
  // be badged as modeled — this is the clean/real-data path.
  const observed: OptionGreeksSnapshot = {
    delta: 0.42,
    gamma: 0.03,
    iv: 0.14,
    theta_per_hour: -0.2,
    entry_premium: 2.5,
    entry_spot: 5400,
    synthetic_fields: [],
  };
  const pnl = estimateOptionPnl({ greeks: observed, current_spot: 5410, minutes_held: 30 });
  assert.equal(pnl.modeled, false);
  assert.deepEqual([...pnl.modeled_fields], []);
});

test("estimateOptionPnl: modeled flag does NOT change the numeric estimate", () => {
  // Same numbers, observed vs synthetic provenance → identical net_premium_pnl.
  const observed: OptionGreeksSnapshot = {
    delta: 0.35, gamma: 0.02, iv: 0.15, theta_per_hour: -0.3,
    entry_premium: 2.5, entry_spot: 5400, synthetic_fields: [],
  };
  const synthetic: OptionGreeksSnapshot = { ...observed, synthetic_fields: ["delta", "gamma"] };
  const a = estimateOptionPnl({ greeks: observed, current_spot: 5412, minutes_held: 45 });
  const b = estimateOptionPnl({ greeks: synthetic, current_spot: 5412, minutes_held: 45 });
  assert.equal(a.net_premium_pnl, b.net_premium_pnl);
  assert.equal(a.modeled, false);
  assert.equal(b.modeled, true);
});

test("estimateOptionPnl: theta loss pinned exactly to -entry_premium", () => {
  const greeks = buildGreeksSnapshot({
    direction: "long",
    entry_spot: 5400,
    option_mid: 2.5,
    delta: 0.4,
    gamma: 0.02,
    iv: 0.15,
  });
  const pnl = estimateOptionPnl({
    greeks,
    current_spot: 5400,
    minutes_held: 600,
    round_trip_cost_pts: 0,
  });
  assert.equal(pnl.theta_pnl, -2.5);
});

test("estimateOptionPnl: net premium floored at -entry_premium", () => {
  const greeks = buildGreeksSnapshot({
    direction: "long",
    entry_spot: 5400,
    option_mid: 2.5,
    delta: 0.5,
    gamma: 0,
    iv: 0.15,
  });
  const pnl = estimateOptionPnl({
    greeks,
    current_spot: 5380,
    minutes_held: 5,
    round_trip_cost_pts: 0,
  });
  assert.equal(pnl.net_premium_pnl, -2.5);
});

test("estimateOptionPnl: theta loss capped at entry premium (legacy assertion)", () => {
  const greeks = buildGreeksSnapshot({
    direction: "long",
    entry_spot: 5400,
    option_mid: 2.5,
    delta: 0.4,
    gamma: 0.02,
  });
  const pnl = estimateOptionPnl({
    greeks,
    current_spot: 5400,
    minutes_held: 600,
    round_trip_cost_pts: 0,
  });
  assert.ok(pnl.theta_pnl >= -greeks.entry_premium);
});

test("estimateOptionPnl: long gains on spot up", () => {
  const greeks = buildGreeksSnapshot({
    direction: "long",
    entry_spot: 5400,
    option_mid: 2.5,
    delta: 0.4,
  });
  const pnl = estimateOptionPnl({
    greeks,
    current_spot: 5408,
    minutes_held: 5,
    round_trip_cost_pts: 0.15,
  });
  assert.ok(pnl.net_premium_pnl > 0);
});
