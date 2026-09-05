import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Route-level regression (CCQ-012 / CQ-170): lib-level Whop tests exist, but this path had no
// route.test.ts proving unwrap() failures return 400 and missing-secret prod returns 503.

let recordApiCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/api-telemetry", {
  namedExports: {
    recordApiCall: (entry: Record<string, unknown>) => {
      recordApiCalls.push(entry);
    },
  },
});

mock.module("@/features/spx/lib/spx-play-notify", {
  namedExports: {
    notifyOpsDiscord: async () => true,
  },
});

function postWhop(body = "{}", headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("https://blackouttrades.com/api/webhook/whop", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
    }),
  );
}

let POST: typeof import("./route").POST;

describe("POST /api/webhook/whop — signature verification", () => {
  before(async () => {
    process.env.WHOP_API_KEY = "test-whop-key";
    process.env.WHOP_WEBHOOK_SECRET = "whsec_test_route_level_signature_gate";
    delete process.env.REDIS_URL;
    ({ POST } = await import("./route"));
  });

  test("invalid webhook signature returns 400 and records telemetry failure", async () => {
    recordApiCalls = [];

    const res = await postWhop('{"type":"membership.activated"}', {
      "webhook-id": "evt_bad",
      "webhook-timestamp": "1700000000",
      "webhook-signature": "v1,not-a-real-hmac",
    });

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "Invalid webhook signature");
    assert.ok(
      recordApiCalls.some(
        (c) => c.endpoint === "webhook/whop" && c.status === 400 && c.error === "invalid_webhook_signature",
      ),
      "expected invalid_webhook_signature telemetry",
    );
  });
});

describe("POST /api/webhook/whop — missing WHOP_WEBHOOK_SECRET", () => {
  test("non-production acknowledges with 200 warning (dev convenience)", async () => {
    recordApiCalls = [];
    const prevSecret = process.env.WHOP_WEBHOOK_SECRET;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.WHOP_WEBHOOK_SECRET = "";
    process.env.NODE_ENV = "test";

    const mod = await import(`./route?reimport=${Date.now()}`);
    const res = await mod.POST(
      new Request("https://blackouttrades.com/api/webhook/whop", { method: "POST", body: "{}" }),
    );

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.warning, "webhook_secret_not_configured");

    process.env.WHOP_WEBHOOK_SECRET = prevSecret;
    process.env.NODE_ENV = prevNodeEnv;
  });

  test("production returns 503 so Whop retries instead of dropping the event", async () => {
    recordApiCalls = [];
    const prevSecret = process.env.WHOP_WEBHOOK_SECRET;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.WHOP_WEBHOOK_SECRET = "";
    process.env.NODE_ENV = "production";

    const mod = await import(`./route?reimport=${Date.now() + 1}`);
    const res = await mod.POST(
      new Request("https://blackouttrades.com/api/webhook/whop", { method: "POST", body: "{}" }),
    );

    assert.equal(res.status, 503);
    const json = await res.json();
    assert.equal(json.error, "webhook_secret_not_configured");
    assert.equal(json.retryable, true);

    process.env.WHOP_WEBHOOK_SECRET = prevSecret;
    process.env.NODE_ENV = prevNodeEnv;
  });
});
