import assert from "node:assert/strict";
import { test } from "node:test";
import { attributeReferralSignup, getReferralStatsForUser, markReferralConverted } from "./referrals.ts";

// Injected fakes (see referrals.ts's Deps type) — no ESM module mocking needed.
function fakeDeps(overrides: {
  configured?: boolean;
  queryImpl?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
}) {
  const notified: unknown[] = [];
  return {
    deps: {
      dbConfigured: () => overrides.configured ?? true,
      dbQuery: (overrides.queryImpl ?? (async () => ({ rows: [], rowCount: 0 }))) as never,
      notifyOpsDiscord: async (payload: unknown) => {
        notified.push(payload);
      },
    },
    notified,
  };
}

test("attributeReferralSignup rejects self-referral without touching the DB", async () => {
  let queried = false;
  const { deps } = fakeDeps({ queryImpl: async () => { queried = true; return { rows: [] }; } });
  const result = await attributeReferralSignup(
    { referrerUserId: "user_abc", referredUserId: "user_abc" },
    deps
  );
  assert.equal(result.attributed, false);
  assert.equal(queried, false, "self-referral must never reach the database");
});

test("attributeReferralSignup rejects empty referrer/referred ids without touching the DB", async () => {
  let queried = false;
  const { deps } = fakeDeps({ queryImpl: async () => { queried = true; return { rows: [] }; } });
  assert.equal(
    (await attributeReferralSignup({ referrerUserId: "", referredUserId: "user_xyz" }, deps)).attributed,
    false
  );
  assert.equal(
    (await attributeReferralSignup({ referrerUserId: "user_abc", referredUserId: "" }, deps)).attributed,
    false
  );
  assert.equal(queried, false);
});

test("attributeReferralSignup writes the referral row and reports whether it was newly attributed", async () => {
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  const { deps } = fakeDeps({
    queryImpl: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params ?? [];
      return { rows: [{ id: 1 }], rowCount: 1 };
    },
  });
  const result = await attributeReferralSignup(
    {
      referrerUserId: "user_referrer",
      referredUserId: "user_referred",
      referredEmail: "new@example.com",
    },
    deps
  );
  assert.equal(result.attributed, true);
  assert.match(capturedSql, /INSERT INTO referrals/);
  assert.match(capturedSql, /ON CONFLICT \(referred_user_id\) DO NOTHING/);
  assert.deepEqual(capturedParams, ["user_referrer", "user_referred", "new@example.com"]);
});

test("attributeReferralSignup no-ops (never throws) when the DB is not configured", async () => {
  let queried = false;
  const { deps } = fakeDeps({
    configured: false,
    queryImpl: async () => { queried = true; throw new Error("must not be called"); },
  });
  const result = await attributeReferralSignup(
    { referrerUserId: "user_referrer", referredUserId: "user_referred" },
    deps
  );
  assert.equal(result.attributed, false);
  assert.equal(queried, false);
});

test("getReferralStatsForUser rolls converted+rewarded counts into the signedUp total", async () => {
  const { deps } = fakeDeps({
    queryImpl: async () => ({
      rows: [
        { status: "signed_up", count: "3" },
        { status: "converted", count: "2" },
        { status: "rewarded", count: "1" },
      ],
    }),
  });
  const stats = await getReferralStatsForUser("user_referrer", deps);
  // Every referral this user owns counts toward "signed up" (they all did),
  // regardless of whether they've since progressed to converted/rewarded.
  assert.deepEqual(stats, { signedUp: 6, converted: 2, rewarded: 1 });
});

test("getReferralStatsForUser returns zeros when the DB is not configured", async () => {
  const { deps } = fakeDeps({ configured: false });
  const stats = await getReferralStatsForUser("user_referrer", deps);
  assert.deepEqual(stats, { signedUp: 0, converted: 0, rewarded: 0 });
});

test("markReferralConverted updates only a 'signed_up' row and notifies ops on success", async () => {
  let capturedSql = "";
  const { deps, notified } = fakeDeps({
    queryImpl: async (sql) => {
      capturedSql = sql;
      return { rows: [{ referrer_user_id: "user_referrer" }] };
    },
  });
  const result = await markReferralConverted("user_referred", deps);
  assert.deepEqual(result, { referrerUserId: "user_referrer" });
  assert.match(capturedSql, /WHERE referred_user_id = \$1 AND status = 'signed_up'/);
  // notifyOpsDiscord is fire-and-forget (void + .catch) — give the microtask a tick.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(notified.length, 1);
});

test("markReferralConverted returns null (no notification) when no matching row exists", async () => {
  const { deps, notified } = fakeDeps({ queryImpl: async () => ({ rows: [] }) });
  const result = await markReferralConverted("user_not_referred", deps);
  assert.equal(result, null);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(notified.length, 0);
});
