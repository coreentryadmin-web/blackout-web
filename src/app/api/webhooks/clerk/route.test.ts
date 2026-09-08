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

mock.module("next/headers", {
  namedExports: {
    headers: async () => ({
      get: (name: string) =>
        ({ "svix-id": "msg_test", "svix-timestamp": "1700000000", "svix-signature": "v1,test" })[name] ?? null,
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

    const res = await postWebhook(
      clerkUserEvent("user.created", "user_real_1", "real-member@gmail.com")
    );

    assert.equal(res.status, 200);
    assert.deepEqual(syncWhopCalls, ["real-member@gmail.com"], "a real member's Whop membership must still sync");
  });
});
