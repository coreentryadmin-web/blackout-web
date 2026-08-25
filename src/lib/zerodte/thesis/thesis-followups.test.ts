import { test } from "node:test";
import assert from "node:assert/strict";
import { crossProductCorroborationBoost } from "./rails/legacy-bridge";
import { aggregateHelixTapeByTicker } from "./helix-tape-extras";

test("crossProductCorroborationBoost adds for aligned dark pool + helix", () => {
  const boost = crossProductCorroborationBoost("long", {
    dark_pool_bias: "bullish",
    helix_direction_bias: "long",
    helix_gross_premium: 2_000_000,
  });
  assert.ok(boost >= 9);
});

test("aggregateHelixTapeByTicker computes direction bias", () => {
  const map = aggregateHelixTapeByTicker([
    { ticker: "NVDA", premium: 800_000, option_type: "call" },
    { ticker: "NVDA", premium: 200_000, option_type: "put" },
  ]);
  const agg = map.get("NVDA");
  assert.equal(agg?.direction_bias, "long");
});
