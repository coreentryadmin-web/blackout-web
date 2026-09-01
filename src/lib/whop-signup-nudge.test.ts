import assert from "node:assert/strict";
import { test } from "node:test";
import { wasSignupNudgeSent, markSignupNudgeSent } from "./whop-signup-nudge.ts";

// Regression coverage for the "you paid, now go create your account" gap: a real BlackOut
// customer can complete a Whop trial/charge (checkout requires no sign-in first — see
// UpgradePageShell) and never reach the desk, because access is granted by matching EMAIL at
// Clerk sign-up, not by the Whop purchase. syncWhopMembershipForEmail already resolves a real
// billingKind for this case with an EMPTY updatedUserIds ("no Clerk account yet" branch) — the
// webhook route uses that combination to send a one-time nudge, deduped here the same way
// whop-dunning.ts dedupes its own per-membership state.
//
// No REDIS_URL is set in this test env, so shared-cache.ts falls through to its real in-memory
// map — this exercises the actual fallback path, not a mock.

test("a membership with no recorded nudge has not been sent one", async () => {
  const membershipId = `mem_fresh_${Math.random()}`;
  assert.equal(await wasSignupNudgeSent(membershipId), false);
});

test("marking a nudge sent is then reflected", async () => {
  const membershipId = `mem_sent_${Math.random()}`;
  await markSignupNudgeSent(membershipId);
  assert.equal(await wasSignupNudgeSent(membershipId), true);
});

test("a redelivery of the same still-unsigned-up membership is deduped", async () => {
  const membershipId = `mem_dup_${Math.random()}`;
  assert.equal(await wasSignupNudgeSent(membershipId), false);
  await markSignupNudgeSent(membershipId);
  // second observation (webhook retry, or the hourly reconcile re-seeing the same gap)
  // must read as already-sent so the caller skips a duplicate send
  assert.equal(await wasSignupNudgeSent(membershipId), true);
});

test("fail-open: a null/undefined membership id is never treated as already-sent, and never throws", async () => {
  assert.equal(await wasSignupNudgeSent(null), false);
  assert.equal(await wasSignupNudgeSent(undefined), false);
  await markSignupNudgeSent(null);
  await markSignupNudgeSent(undefined);
});
