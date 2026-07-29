import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFlowPolarity,
  countClearingScoreFloor,
  legacyCallPutDirection,
  signedAggressionDirection,
} from "./flow-polarity";

test("legacyCallPutDirection: put-heavy tape → short regardless of bid/ask", () => {
  const flows = [
    { type: "put", premium: 2_000_000, trade_side: "B" }, // aggressive put SELL
    { type: "call", premium: 500_000, trade_side: "A" },
  ];
  const r = legacyCallPutDirection(flows);
  assert.equal(r.direction, "short");
});

test("signedAggressionDirection: bid-side puts → bullish (closing/selling puts)", () => {
  const flows = [
    { type: "put", premium: 2_000_000, trade_side: "B" },
    { type: "call", premium: 500_000, trade_side: "A" },
  ];
  const r = signedAggressionDirection(flows);
  assert.equal(r.direction, "long", "bid puts + ask calls should net bullish");
});

test("compareFlowPolarity: flags Legacy vs signed disagreement on bid-put dominant tape", () => {
  const flows = [
    { type: "put", premium: 3_000_000, trade_side: "B" },
    { type: "call", premium: 200_000, trade_side: "A" },
  ];
  const c = compareFlowPolarity(flows);
  assert.equal(c.legacy_direction, "short");
  assert.equal(c.signed_direction, "long");
  assert.equal(c.disagree, true);
  assert.ok(c.bid_put_share_of_puts > 0.9);
});

test("compareFlowPolarity: ask-put dominant tape agrees SHORT", () => {
  const flows = [
    { type: "put", premium: 2_000_000, trade_side: "A" },
    { type: "call", premium: 200_000, trade_side: "B" },
  ];
  const c = compareFlowPolarity(flows);
  assert.equal(c.legacy_direction, "short");
  assert.equal(c.signed_direction, "short");
  assert.equal(c.disagree, false);
});

test("countClearingScoreFloor: counterfactual for publish floors", () => {
  const scored = [{ score: 71 }, { score: 49 }, { score: 26 }, { score: 20 }, { score: 55 }];
  assert.deepEqual(countClearingScoreFloor(scored, 42), {
    clearing: 3,
    total: 5,
    clearing_frac: 0.6,
  });
  assert.equal(countClearingScoreFloor(scored, 50).clearing, 2);
  assert.equal(countClearingScoreFloor(scored, 72).clearing, 0);
});
