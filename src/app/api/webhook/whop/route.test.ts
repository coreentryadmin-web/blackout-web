import { before, describe, test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Route-level coverage for Whop billing webhook signature verification and the
// missing-secret fail-closed path. Lib-level Whop helpers have their own tests;
// this closes the gap CCQ-012 flagged: unwrap() failure was untested at the route.

let unwrapShouldThrow = false;
let syncCalls: string[] = [];
let recordCalls: Array<{ status: number; ok: boolean; error?: string }> = [];

mock.module("@whop/sdk", {
  defaultExport: class Whop {
    webhooks = {
      unwrap: (_body: string, _opts: { headers: Record<string, string> }) => {
        if (unwrapShouldThrow) throw new Error("invalid signature");
        return {
          id: "evt_ok",
          type: "membership.activated",
          company_id: "test-whop-company",
          data: { id: "mem_1", user: { email: "member@example.com" }, status: "active" },
        };
      },
    };
  },
});

mock.module("../../../../lib/membership", {
  namedExports: {
    syncWhopMembershipForEmail: async (email: string) => {
      syncCalls.push(email);
      return { tier: "premium", billingKind: "premium", updatedUserIds: ["user_1"] };
    },
  },
});

mock.module("../../../../lib/billing-lifecycle-email", {
  namedExports: {
    syncWhopMembershipAndNotify: async (email: string) => {
      syncCalls.push(email);
      return { updatedUserIds: ["user_1"], billingKind: "premium" as const };
    },
    notifyScheduledCancellation: async () => {},
    notifyCancellationReversed: async () => {},
    notifyPaymentFailed: async () => {},
    notifyTrialEndingSoon: async () => false,
  },
});

mock.module("../../../../lib/tier-cache", {
  namedExports: {
    publishTierChanged: () => {},
  },
});

mock.module("../../../../lib/whop-revocation", {
  namedExports: {
    markMembershipRevoked: async () => {},
  },
});

mock.module("../../../../lib/whop-dunning", {
  namedExports: {
    clearMembershipDunningGrace: async () => {},
    isMembershipInDunningGrace: async () => false,
    markMembershipDunningGrace: async () => {},
    dunningGraceDays: () => 3,
    wasCancelAtPeriodEndAlreadyNotified: async () => true,
    markCancelAtPeriodEndNotified: async () => {},
  },
});

mock.module("../../../../features/spx/lib/spx-play-notify", {
  namedExports: {
    notifyOpsDiscord: async () => true,
  },
});

mock.module("../../../../lib/api-telemetry", {
  namedExports: {
    recordApiCall: (payload: { status: number; ok: boolean; error?: string }) => {
      recordCalls.push(payload);
    },
  },
});

mock.module("../../../../lib/make-redis", {
  namedExports: {
    makeRedis: async () => ({
      set: async () => "OK",
      del: async () => 1,
      quit: async () => undefined,
    }),
  },
});

mock.module("../../../../lib/whop-signup-nudge", {
  namedExports: {
    wasSignupNudgeSent: async () => true,
    markSignupNudgeSent: async () => {},
  },
});

mock.module("../../../../lib/whop-trial-nudge", {
  namedExports: {
    wasTrialEndingNudgeSent: async () => true,
    markTrialEndingNudgeSent: async () => {},
  },
});

mock.module("../../../../lib/email/resend-client", {
  namedExports: {
    sendEmail: async () => ({ ok: true }),
  },
});

describe("POST /api/webhook/whop — route-level signature + secret handling", () => {
  let POST: typeof import("./route").POST;

  before(async () => {
    process.env.WHOP_API_KEY = "test-whop-key";
    process.env.WHOP_COMPANY_ID = "test-whop-company";
    process.env.WHOP_WEBHOOK_SECRET = "test-whop-webhook-secret";
    process.env.NODE_ENV = "test";
    ({ POST } = await import("./route"));
  });

  afterEach(() => {
    unwrapShouldThrow = false;
    syncCalls = [];
    recordCalls = [];
    process.env.WHOP_WEBHOOK_SECRET = "test-whop-webhook-secret";
    process.env.NODE_ENV = "test";
  });

  function postWebhook(body = "{}"): Promise<Response> {
    return POST(
      new Request("https://blackouttrades.com/api/webhook/whop", {
        method: "POST",
        headers: {
          "webhook-id": "msg_test",
          "webhook-timestamp": "1700000000",
          "webhook-signature": "v1,test",
        },
        body,
      })
    );
  }

  test("returns 400 when whop.webhooks.unwrap rejects the signature", async () => {
    unwrapShouldThrow = true;

    const res = await postWebhook('{"type":"membership.activated"}');

    assert.equal(res.status, 400);
    const json = (await res.json()) as { error?: string };
    assert.equal(json.error, "Invalid webhook signature");
    assert.equal(syncCalls.length, 0, "must not process when signature fails");
    assert.ok(
      recordCalls.some((c) => c.status === 400 && c.error === "invalid_webhook_signature"),
      "telemetry must record invalid_webhook_signature"
    );
  });

  test("returns 503 in production when WHOP_WEBHOOK_SECRET is unset", async () => {
    process.env.WHOP_WEBHOOK_SECRET = "";
    process.env.NODE_ENV = "production";

    const res = await postWebhook();

    assert.equal(res.status, 503);
    const json = (await res.json()) as { error?: string; retryable?: boolean };
    assert.equal(json.error, "webhook_secret_not_configured");
    assert.equal(json.retryable, true);
    assert.equal(syncCalls.length, 0);
  });

  test("fail-open Redis idempotency path alerts ops (CQ-114 source contract)", () => {
    const src = readFileSync("src/app/api/webhook/whop/route.ts", "utf8");
    const failOpen = src.slice(src.indexOf("idempotency claim failed"), src.indexOf("return true; // fail-open"));
    assert.match(failOpen, /notifyOpsDiscord\(/, "Redis fail-open must alert ops — dedup is offline");
    assert.match(failOpen, /idempotency fail-open/i);
  });

  test("returns 200 with warning in non-production when WHOP_WEBHOOK_SECRET is unset", async () => {
    process.env.WHOP_WEBHOOK_SECRET = "";
    process.env.NODE_ENV = "development";

    const res = await postWebhook();

    assert.equal(res.status, 200);
    const json = (await res.json()) as { warning?: string };
    assert.equal(json.warning, "webhook_secret_not_configured");
    assert.equal(syncCalls.length, 0);
  });
});
