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
  assert.equal(helixContractKey(flow), "NVDA|140|2026-08-21|C");
});
