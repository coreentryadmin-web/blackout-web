import assert from "node:assert/strict";
import { test } from "node:test";
import { wasTrialEndingNudgeSent, markTrialEndingNudgeSent } from "./whop-trial-nudge.ts";

test("trial nudge dedup: fresh membership is not marked sent", async () => {
  const id = `mem_trial_${Math.random()}`;
  assert.equal(await wasTrialEndingNudgeSent(id), false);
});

test("trial nudge dedup: mark then read", async () => {
  const id = `mem_trial_sent_${Math.random()}`;
  await markTrialEndingNudgeSent(id);
  assert.equal(await wasTrialEndingNudgeSent(id), true);
});

test("trial nudge dedup: null id is fail-open", async () => {
  assert.equal(await wasTrialEndingNudgeSent(null), false);
  await markTrialEndingNudgeSent(undefined);
});
