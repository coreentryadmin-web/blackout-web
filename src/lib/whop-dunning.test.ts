import assert from "node:assert/strict";
import { test } from "node:test";
import { wasCancelAtPeriodEndAlreadyNotified, markCancelAtPeriodEndNotified } from "./whop-dunning.ts";

// Regression coverage for the cancel_at_period_end_changed dedup gap flagged in review on
// #1901: notifyScheduledCancellation/notifyCancellationReversed had only the top-of-route
// Redis idempotency claim (documented fail-open) standing between a Whop redelivery and a
// duplicate customer email. wasCancelAtPeriodEndAlreadyNotified/markCancelAtPeriodEndNotified
// close that the same way markMembershipDunningGrace/isMembershipInDunningGrace already do for
// payment.failed — a small Redis-or-in-memory state snapshot per membership.
//
// No REDIS_URL is set in this test env, so shared-cache.ts falls through to its real in-memory
// map — these exercise the actual fallback path, not a mock.

test("a membership with no recorded state has not been notified either way", async () => {
  const membershipId = `mem_fresh_${Math.random()}`;
  assert.equal(await wasCancelAtPeriodEndAlreadyNotified(membershipId, true), false);
  assert.equal(await wasCancelAtPeriodEndAlreadyNotified(membershipId, false), false);
});

test("re-observing the same cancel_at_period_end value is deduped", async () => {
  const membershipId = `mem_dup_${Math.random()}`;
  await markCancelAtPeriodEndNotified(membershipId, true);
  assert.equal(await wasCancelAtPeriodEndAlreadyNotified(membershipId, true), true);
  // a redelivery of the SAME state should be a no-op — the caller skips the send
});

test("a flip to the opposite value is not deduped — the state genuinely changed", async () => {
  const membershipId = `mem_flip_${Math.random()}`;
  await markCancelAtPeriodEndNotified(membershipId, true);
  assert.equal(await wasCancelAtPeriodEndAlreadyNotified(membershipId, false), false);

  await markCancelAtPeriodEndNotified(membershipId, false);
  assert.equal(await wasCancelAtPeriodEndAlreadyNotified(membershipId, false), true);
  assert.equal(await wasCancelAtPeriodEndAlreadyNotified(membershipId, true), false);
});

test("fail-open: a null/undefined membership id is never treated as already-notified", async () => {
  assert.equal(await wasCancelAtPeriodEndAlreadyNotified(null, true), false);
  assert.equal(await wasCancelAtPeriodEndAlreadyNotified(undefined, false), false);
  // must not throw — the webhook route always awaits this
  await markCancelAtPeriodEndNotified(null, true);
  await markCancelAtPeriodEndNotified(undefined, false);
});
