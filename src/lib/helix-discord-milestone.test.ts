import assert from "node:assert/strict";
import { test } from "node:test";
import {
  helixContractKey,
  hitMilestoneForCount,
  isHelixRepeatFlow,
  shouldPostHelixRepeatLive,
  HELIX_STACK_MILESTONES,
} from "./helix-discord-milestone.ts";

const flow = {
  ticker: "NVDA",
  premium: 900_000,
  option_type: "CALL",
  expiry: "2026-08-21",
  strike: 140,
  alert_rule: "RepeatedHits",
};

test("isHelixRepeatFlow detects repeat alert rules", () => {
  assert.equal(isHelixRepeatFlow(flow), true);
  assert.equal(isHelixRepeatFlow({ ...flow, alert_rule: null }), false);
});

test("hitMilestoneForCount fires at 3 5 10", () => {
  assert.equal(hitMilestoneForCount(2, 0), null);
  assert.equal(hitMilestoneForCount(3, 0), 3);
  assert.equal(hitMilestoneForCount(4, 3), null);
  assert.equal(hitMilestoneForCount(5, 3), 5);
  assert.equal(hitMilestoneForCount(10, 5), 10);
  assert.equal(HELIX_STACK_MILESTONES.join(","), "3,5,10");
});

test("shouldPostHelixRepeatLive only on milestones", () => {
  assert.equal(shouldPostHelixRepeatLive(1, 0), false);
  assert.equal(shouldPostHelixRepeatLive(3, 0), true);
  assert.equal(shouldPostHelixRepeatLive(4, 3), false);
});

test("helixContractKey is stable per contract", () => {
  // Strike is now quantised in MILLS, not dollars — see lib/helix/contract-identity.ts.
  assert.equal(helixContractKey(flow), "NVDA|140000|2026-08-21|C");
  assert.equal(helixContractKey({ ...flow, strike: 140.0000000001 }), helixContractKey(flow));
});

test("helixContractKey separates a half-dollar strike from the strike above it", () => {
  // The old assertion above checked only that ONE contract keyed stably, so it could not see that
  // TWO contracts keyed the SAME. Under the dollar-rounded key, 92.5P and 93P shared one milestone
  // counter, and the second contract's genuine 3rd hit found lastPosted:3 and never posted.
  const p925 = { ...flow, ticker: "INTC", option_type: "PUT", strike: 92.5 };
  const p93 = { ...p925, strike: 93 };
  assert.notEqual(helixContractKey(p925), helixContractKey(p93));
});

test("helixContractKey still buckets a strikeless row by ticker/expiry/side", () => {
  // A cache key must exist for every row, but an unusable strike must not collapse unrelated
  // contracts onto one counter.
  const noStrike = { ...flow, strike: Number.NaN };
  assert.match(helixContractKey(noStrike), /nostrike/);
  assert.notEqual(helixContractKey(noStrike), helixContractKey({ ...noStrike, option_type: "PUT" }));
});
