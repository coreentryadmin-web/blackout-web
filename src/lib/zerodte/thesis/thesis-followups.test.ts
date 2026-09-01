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

test("aggregateHelixTapeByTicker computes direction bias off aggressor-read premium", () => {
  const map = aggregateHelixTapeByTicker([
    { ticker: "NVDA", premium: 800_000, option_type: "call", ask_pct: 90 }, // call bought -> bullish
    { ticker: "NVDA", premium: 200_000, option_type: "put", ask_pct: 90 }, // put bought -> bearish
  ]);
  const agg = map.get("NVDA");
  assert.equal(agg?.direction_bias, "long");
  assert.equal(agg?.call_premium, 800_000);
  assert.equal(agg?.put_premium, 200_000);
});

test("aggregateHelixTapeByTicker: a SOLD call reads bearish, not bullish off call-share alone", () => {
  // Regression for the option-type-only conflation: this used to count ALL call premium as
  // bullish regardless of aggressor side, so 100% call-share always read "long". A call that was
  // SOLD (ask_pct low -> seller-initiated) is bearish, and a tape that is entirely sold calls must
  // not read "long" just because none of the premium was in puts.
  const map = aggregateHelixTapeByTicker([
    { ticker: "CG", premium: 5_000_000, option_type: "call", ask_pct: 5 }, // call sold -> bearish
    { ticker: "CG", premium: 3_000_000, option_type: "call", ask_pct: 8 }, // call sold -> bearish
  ]);
  const agg = map.get("CG");
  assert.equal(agg?.direction_bias, "short");
  // The naive rule's own inputs are unchanged (100% call premium) — only the read differs.
  assert.equal(agg?.call_premium, 8_000_000);
  assert.equal(agg?.put_premium, 0);
});

test("aggregateHelixTapeByTicker: no ask_pct data means undetermined, not a call-share guess", () => {
  const map = aggregateHelixTapeByTicker([
    { ticker: "SPX", premium: 1_000_000, option_type: "call" },
  ]);
  assert.equal(map.get("SPX")?.direction_bias, null);
});
