import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression: syncWhopForClerkUser() ran UNCONDITIONALLY for every user.created/user.updated
// webhook — unlike the welcome-email and ops-Discord calls two blocks above it in the same
// handler, which already skip isInternalAuditEmail() accounts. scripts/audit/*.mjs mint dozens
// of temp Clerk accounts against PRODUCTION every day (see internal-audit-email.ts's own doc
// comment); each one's user.created/user.updated event was hitting Whop's API for a membership
// that can never exist, then logging a `console.error` 404 — real per-account network cost plus
// ERROR-level noise that would drown out a genuine Whop sync failure for a real member. Fixed by
// applying the same isInternalAuditEmail() gate already used for the two calls above it.

process.env.CLERK_WEBHOOK_SECRET = "test-hermetic-webhook-secret";
// syncWhopForClerkUser() fail-opens when Whop env is absent — the mock on
// syncWhopMembershipForEmail is never reached without these set.
process.env.WHOP_COMPANY_ID = "test-whop-company";
process.env.WHOP_API_KEY = "test-whop-key";

let dbQueryCalls: Array<{ text: string; values: unknown[] | undefined }> = [];
let syncWhopCalls: string[] = [];
let dbQueryShouldThrowOnce = false;

// Each test sets its own svix-id (via setSvixId) before posting — the route now dedupes
// on svix-id (see the idempotency describe block below), so reusing one fixed id across
// every test would make every test after the first read as a "duplicate delivery" and
// skip all processing.
let currentSvixId = "msg_test_default";
function setSvixId(id: string): void {
  currentSvixId = id;
}

mock.module("next/headers", {
  namedExports: {
    headers: async () => ({
      get: (name: string) =>
        ({ "svix-id": currentSvixId, "svix-timestamp": "1700000000", "svix-signature": "v1,test" })[name] ?? null,
    }),
  },
});

// svix's real HMAC verification is irrelevant to the business logic under test — the mock
// class just returns the parsed body, exactly like a successfully-verified webhook would.
mock.module("svix", {
  namedExports: {
    Webhook: class {
      constructor(_secret: string) {}
      verify(body: string) {
        return JSON.parse(body);
      }
    },
  },
});

mock.module("../../../../lib/db", {
  namedExports: {
    dbQuery: async (text: string, values?: unknown[]) => {
      dbQueryCalls.push({ text, values });
      if (dbQueryShouldThrowOnce) {
        dbQueryShouldThrowOnce = false;
        throw new Error("simulated db failure");
      }
      return { rows: [], rowCount: 0 };
    },
    deleteUserDataForClerkId: async () => ({ users: 0, largo_sessions: 0, user_journal: 0, push_subscriptions: 0 }),
  },
});

mock.module("../../../../lib/admin-users", {
  namedExports: {
    upsertAdminUserRow: async () => {},
  },
});

mock.module("../../../../lib/membership", {
  namedExports: {
    syncWhopMembershipForEmail: async (email: string) => {
      syncWhopCalls.push(email);
      return { tier: "free", billingKind: "free", updatedUserIds: [] };
    },
  },
});

mock.module("../../../../lib/tier-cache", {
  namedExports: {
    publishTierChanged: () => {},
  },
});

mock.module("../../../../lib/welcome-sequence", {
  namedExports: {
    startWelcomeSequence: async () => {},
  },
});

mock.module("../../../../features/spx/lib/spx-play-notify", {
  namedExports: {
    notifyOpsDiscord: async () => true,
  },
});

function clerkUserEvent(type: "user.created" | "user.updated", userId: string, email: string) {
  return {
    type,
    data: {
      id: userId,
      primary_email_address_id: "idn_1",
      email_addresses: [{ id: "idn_1", email_address: email }],
      first_name: "Test",
      last_name: "User",
      public_metadata: {},
    },
  };
}

describe("POST /api/webhooks/clerk — Whop sync skips internal audit accounts", () => {
  let POST: typeof import("./route").POST;

  before(async () => {
    ({ POST } = await import("./route"));
  });

  function postWebhook(payload: unknown): Promise<Response> {
    return POST(new Request("https://blackouttrades.com/api/webhooks/clerk", {
      method: "POST",
      body: JSON.stringify(payload),
    }));
  }

  test("user.updated for an internal audit account does NOT call syncWhopMembershipForEmail", async () => {
    dbQueryCalls = [];
    syncWhopCalls = [];
    setSvixId("msg_audit_update_1");

    const res = await postWebhook(
      clerkUserEvent("user.updated", "user_audit_1", "seo-audit-1788092138340@blackouttrades.com")
    );

    assert.equal(res.status, 200);
    assert.equal(syncWhopCalls.length, 0, "an internal audit account must never trigger a Whop sync call");
    // Still provisioned/updated normally — only the Whop sync is skipped, same as the
    // welcome-email/ops-Discord calls this mirrors.
    assert.ok(dbQueryCalls.length > 0, "the DB row update must still happen for an audit account");
  });

  test("user.created for a real member email still calls syncWhopMembershipForEmail", async () => {
    dbQueryCalls = [];
    syncWhopCalls = [];
    setSvixId("msg_real_created_1");

    const res = await postWebhook(
      clerkUserEvent("user.created", "user_real_1", "real-member@gmail.com")
    );

    assert.equal(res.status, 200);
    assert.deepEqual(syncWhopCalls, ["real-member@gmail.com"], "a real member's Whop membership must still sync");
  });
});

// Regression for the duplicate-processing bug: before this fix, the route had NO
// idempotency guard at all, so a Svix redelivery of the SAME event (same svix-id —
// Svix's own message id, stable across retries) re-ran the full handler a second time —
// a second Whop API sync call, a second "New member signed up" Discord ping, a second
// GDPR-deletion pass, etc — for one real delivery. Fixed by claiming svix-id via
// sharedCacheSetNx before processing, the same pattern webhook/whop/route.ts's
// claimWhopEvent and webhook/resend/route.ts's claimResendEvent already use.
describe("POST /api/webhooks/clerk — idempotency on redelivery", () => {
  let POST: typeof import("./route").POST;

  before(async () => {
    ({ POST } = await import("./route"));
  });

  function postWebhook(payload: unknown): Promise<Response> {
    return POST(new Request("https://blackouttrades.com/api/webhooks/clerk", {
      method: "POST",
      body: JSON.stringify(payload),
    }));
  }

  test("a redelivered event (same svix-id) is NOT reprocessed (no second Whop sync call)", async () => {
    dbQueryCalls = [];
    syncWhopCalls = [];
    setSvixId("svix_dup_1");

    const first = await postWebhook(clerkUserEvent("user.created", "user_dup_1", "dup-member@gmail.com"));
    assert.equal(first.status, 200);
    assert.deepEqual(syncWhopCalls, ["dup-member@gmail.com"], "first delivery must process normally");
    const dbCallsAfterFirst = dbQueryCalls.length;
    assert.ok(dbCallsAfterFirst > 0, "first delivery must write to the DB");

    // Svix redelivers the SAME event: same svix-id, same payload.
    const second = await postWebhook(clerkUserEvent("user.created", "user_dup_1", "dup-member@gmail.com"));
    assert.equal(second.status, 200, "a redelivery must still be ack'd 200 so Svix stops retrying");
    assert.equal(syncWhopCalls.length, 1, "redelivery must NOT trigger a second Whop sync call");
    assert.equal(dbQueryCalls.length, dbCallsAfterFirst, "redelivery must NOT issue a second DB write");
  });

  test("two different svix-ids each process independently", async () => {
    syncWhopCalls = [];

    setSvixId("svix_distinct_a");
    const a = await postWebhook(clerkUserEvent("user.created", "user_distinct_a", "distinct-a@gmail.com"));
    assert.equal(a.status, 200);

    setSvixId("svix_distinct_b");
    const b = await postWebhook(clerkUserEvent("user.created", "user_distinct_b", "distinct-b@gmail.com"));
    assert.equal(b.status, 200);

    assert.deepEqual(
      syncWhopCalls,
      ["distinct-a@gmail.com", "distinct-b@gmail.com"],
      "two distinct deliveries must both be processed, not over-deduped"
    );
  });

  test("a retry AFTER a failed DB write is reprocessed, not swallowed as a duplicate", async () => {
    syncWhopCalls = [];
    setSvixId("svix_retry_1");
    dbQueryShouldThrowOnce = true;

    const failed = await postWebhook(clerkUserEvent("user.created", "user_retry_1", "retry-member@gmail.com"));
    assert.equal(failed.status, 500, "the first (failing) attempt must surface a 500 so Clerk/Svix retries");
    assert.equal(syncWhopCalls.length, 0, "the failed attempt never reached the Whop sync call");

    // Clerk/Svix retries the SAME event (same svix-id) after the 500 above.
    const retried = await postWebhook(clerkUserEvent("user.created", "user_retry_1", "retry-member@gmail.com"));
    assert.equal(retried.status, 200, "the retry must actually be reprocessed, not silently ack'd as a duplicate");
    assert.deepEqual(
      syncWhopCalls,
      ["retry-member@gmail.com"],
      "the retry must run the full handler the failed attempt never completed"
    );
  });
});
