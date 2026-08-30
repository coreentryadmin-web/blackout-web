import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression: POST /api/membership/sync fires automatically on EVERY authenticated sign-in
// paint (AuthSignedInRedirect.tsx), including every temp/audit Clerk account
// scripts/audit/*.mjs mints against production every day — none of them can ever have a real
// Whop membership, so every audit-account sign-in was a wasted outbound Whop API call. Same
// isInternalAuditEmail() skip already applied to the Clerk webhook's equivalent Whop sync call
// this cycle (docs/audit/findings-staging).

let mockUserId: string | null = "user_test_1";
let mockEmail = "real-member@gmail.com";
let syncWhopCalls: string[] = [];

mock.module("@clerk/nextjs/server", {
  namedExports: {
    auth: async () => ({ userId: mockUserId }),
    currentUser: async () => ({
      emailAddresses: [{ id: "email_1", emailAddress: mockEmail }],
      primaryEmailAddressId: "email_1",
    }),
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

mock.module("../../../../lib/membership-sync-limit", {
  namedExports: {
    acquireMembershipSyncSlot: async () => ({ ok: true }),
  },
});

mock.module("../../../../lib/tier-cache", {
  namedExports: {
    publishTierChanged: () => {},
  },
});

mock.module("../../../../features/spx/lib/spx-play-notify", {
  namedExports: {
    notifyOpsDiscord: async () => true,
  },
});

describe("POST /api/membership/sync — skips internal audit accounts", () => {
  let POST: typeof import("./route").POST;

  before(async () => {
    ({ POST } = await import("./route"));
  });

  test("an internal audit account's sign-in sync does NOT call syncWhopMembershipForEmail", async () => {
    syncWhopCalls = [];
    mockEmail = "seo-audit-1788092138340@blackouttrades.com";

    const res = await POST();
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.tier, "free");
    assert.equal(syncWhopCalls.length, 0, "an internal audit account must never trigger a Whop sync call");
  });

  test("a real member's sign-in sync still calls syncWhopMembershipForEmail", async () => {
    syncWhopCalls = [];
    mockEmail = "real-member@gmail.com";

    const res = await POST();
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(syncWhopCalls, ["real-member@gmail.com"]);
    assert.equal(body.tier, "free");
  });
});
