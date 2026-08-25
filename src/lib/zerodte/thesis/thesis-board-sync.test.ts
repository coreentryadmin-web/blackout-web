import { test } from "node:test";
import assert from "node:assert/strict";
import { syncSetupDiscoveryFromThesis, railToDiscoveryOrigin } from "./thesis-board-sync";

test("railToDiscoveryOrigin maps POSITIONING → PIN", () => {
  assert.equal(railToDiscoveryOrigin("POSITIONING"), "PIN");
  assert.equal(railToDiscoveryOrigin("MOMENTUM"), null);
});

test("syncSetupDiscoveryFromThesis aligns direction and unions origins", () => {
  const setup = {
    ticker: "NVDA",
    direction: "short",
    discovery_origin: ["FLOW"],
    score: 70,
  } as never;
  syncSetupDiscoveryFromThesis(setup, {
    ticker: "NVDA",
    direction: "long",
    rails_fired: ["FLOW", "BREAKOUT"],
    rail_scores: { FLOW: 80, BREAKOUT: 72 },
    systems_aligned: 2,
    trade_archetype: "BREAKOUT",
    archetype_score: 78,
    structural_state: null,
    trigger_price: null,
    summaries: {},
    disagreeing_rails: [],
  });
  assert.equal(setup.direction, "long");
  assert.deepEqual(setup.discovery_origin, ["FLOW", "BREAKOUT"]);
});

test("syncSetupDiscoveryFromThesis stamps origin conflict from disagreeing rails", () => {
  const setup = {
    ticker: "TSLA",
    direction: "long",
    discovery_origin: ["FLOW"],
    score: 70,
  } as never;
  syncSetupDiscoveryFromThesis(setup, {
    ticker: "TSLA",
    direction: "long",
    rails_fired: ["FLOW"],
    rail_scores: { FLOW: 80 },
    systems_aligned: 1,
    trade_archetype: "FLOW_FOLLOWING",
    archetype_score: 75,
    structural_state: null,
    trigger_price: null,
    summaries: {},
    disagreeing_rails: [
      { rail: "POSITIONING", direction: "short", score: 68, summary: "pin fade" },
    ],
  });
  assert.equal(setup.origin_direction_conflict?.masked_direction, "short");
  assert.deepEqual(setup.origin_direction_conflict?.masked_origin, ["PIN"]);
});
