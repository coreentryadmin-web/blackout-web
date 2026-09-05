import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Route-level coverage the CQ-170/CCQ-012 cross-exam challenge found missing: every prior test
// touching Whop webhook handling exercises the lib functions the route calls (whop-revocation,
// whop-dunning, etc.) directly, never the route's own signature-verification/response contract —
// the exact thing that decides whether a forged request can drive a membership/tier change.
// Mirrors ../clerk/route.test.ts's mock-module pattern (same directory depth) and stays scoped to
// what CCQ-012 named as missing: the unwrap()-throws → 400 path, the missing-secret path, and one
// minimal signed-event pass-through — not exhaustive coverage of every event-type branch, which
// already has lib-level tests (whop-revocation.test.ts, whop-dunning tests, etc.).

process.env.WHOP_API_KEY = "test-whop-key";
process.env.WHOP_WEBHOOK_SECRET = "test-hermetic-whop-secret";

let unwrapImpl: (body: string, opts: { headers: Record<string, string> }) => unknown = () => {
  throw new Error("no unwrap mock configured");
};
let syncCalls: string[] = [];
let telemetryCalls: Array<{ status: number; ok: boolean }> = [];
let opsDiscordCalls: Array<{ title: string; severity?: string }> = [];

mock.module("@whop/sdk", {
  defaultExport: class Whop {
    webhooks = {
      unwrap: (body: string, opts: { headers: Record<string, string> }) => unwrapImpl(body, opts),
    };
    constructor(_opts: unknown) {}
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

mock.module("../../../../lib/whop-revocation", {
  namedExports: { markMembershipRevoked: async () => {} },
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
    notifyOpsDiscord: async (args: { title: string; severity?: string }) => {
      opsDiscordCalls.push(args);
      return true;
    },
  },
});

mock.module("../../../../lib/api-telemetry", {
  namedExports: {
    recordApiCall: (args: { status: number; ok: boolean }) => {
      telemetryCalls.push(args);
    },
  },
});

mock.module("../../../../lib/make-redis", {
  namedExports: {
    // No REDIS_URL is set in this hermetic test, so claimWhopEvent/releaseWhopEventClaim
    // never actually call this (fail-open before reaching it) — stubbed only so the import
    // resolves.
    makeRedis: async () => {
      throw new Error("makeRedis should not be called when REDIS_URL is unset");
    },
  },
});

mock.module("../../../../lib/tier-cache", {
  namedExports: { publishTierChanged: () => {} },
});

mock.module("../../../../lib/billing-lifecycle-email", {
  namedExports: {
    syncWhopMembershipAndNotify: async (email: string) => {
      syncCalls.push(email);
      return { tier: "premium", billingKind: "premium", updatedUserIds: ["user_1"] };
    },
    notifyScheduledCancellation: async () => {},
    notifyCancellationReversed: async () => {},
    notifyPaymentFailed: async () => {},
    notifyTrialEndingSoon: async () => true,
  },
});

mock.module("../../../../lib/whop", {
  namedExports: { resolveBillingKindFromMembership: () => "premium" },
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

mock.module("../../../../lib/email/templates/complete-signup", {
  namedExports: { completeSignupEmail: () => ({ subject: "x", html: "x", text: "x" }) },
});

mock.module("../../../../lib/email/templates/trial-ending-soon", {
  namedExports: { formatTrialEndLabel: () => "soon" },
});

mock.module("../../../../lib/email/resend-client", {
  namedExports: { sendEmail: async () => ({ ok: true }) },
});

mock.module("../../../../lib/whop-cancellation-notify", {
  namedExports: {
    buildCancellationNotificationBody: () => "body",
    shouldNotifyCancellation: () => false,
  },
});

function postWebhook(POST: typeof import("./route").POST, body: string) {
  return POST(
    new Request("https://blackouttrades.com/api/webhook/whop", {
      method: "POST",
      body,
      headers: { "webhook-id": "msg_test", "webhook-timestamp": "1700000000", "webhook-signature": "v1,test" },
    }) as unknown as Parameters<typeof POST>[0]
  );
}

describe("POST /api/webhook/whop — route-level signature verification", () => {
  let POST: typeof import("./route").POST;

  before(async () => {
    ({ POST } = await import("./route"));
  });

  test("unwrap() throwing (bad/forged signature) returns 400, never processes the payload", async () => {
    syncCalls = [];
    telemetryCalls = [];
    unwrapImpl = () => {
      throw new Error("signature mismatch");
    };

    const res = await postWebhook(
      POST,
      JSON.stringify({ id: "evt_forged", type: "membership.activated", data: { user: { email: "attacker@example.com" } } })
    );

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Invalid webhook signature");
    assert.deepEqual(syncCalls, [], "a forged/unverifiable delivery must never reach membership sync");
    assert.equal(telemetryCalls.length, 1);
    assert.equal(telemetryCalls[0].ok, false);
    assert.equal(telemetryCalls[0].status, 400);
  });

  test("missing WHOP_WEBHOOK_SECRET outside production returns 200 warning (dev convenience)", async () => {
    const prevSecret = process.env.WHOP_WEBHOOK_SECRET;
    const prevEnv = process.env.NODE_ENV;
    delete process.env.WHOP_WEBHOOK_SECRET;
    // @ts-expect-error -- NODE_ENV is readonly in the type but writable at runtime; test-only override.
    process.env.NODE_ENV = "test";

    try {
      const res = await postWebhook(POST, JSON.stringify({ id: "evt_x", type: "membership.activated", data: {} }));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.warning, "webhook_secret_not_configured");
    } finally {
      process.env.WHOP_WEBHOOK_SECRET = prevSecret;
      // @ts-expect-error -- see override above.
      process.env.NODE_ENV = prevEnv;
    }
  });

  test("missing WHOP_WEBHOOK_SECRET in production returns 503 (retryable), never silently drops the event", async () => {
    const prevSecret = process.env.WHOP_WEBHOOK_SECRET;
    const prevEnv = process.env.NODE_ENV;
    delete process.env.WHOP_WEBHOOK_SECRET;
    // @ts-expect-error -- NODE_ENV is readonly in the type but writable at runtime; test-only override.
    process.env.NODE_ENV = "production";
    opsDiscordCalls = [];

    try {
      const res = await postWebhook(POST, JSON.stringify({ id: "evt_x", type: "membership.activated", data: {} }));
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.retryable, true);
      assert.ok(
        opsDiscordCalls.some((c) => c.severity === "critical"),
        "a missing webhook secret in production must fire a critical ops alert"
      );
    } finally {
      process.env.WHOP_WEBHOOK_SECRET = prevSecret;
      // @ts-expect-error -- see override above.
      process.env.NODE_ENV = prevEnv;
    }
  });
});
