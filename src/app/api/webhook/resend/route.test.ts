import { before, afterEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for the duplicate-row bug: before this fix, the route had NO idempotency
// guard at all, so a Svix redelivery of the SAME event (same svix-id — Svix's own
// message id, stable across retries) inserted a SECOND row into email_events for one
// real delivery, inflating the admin/email-events dashboard's counts.
//
// Run with: node --import tsx --experimental-test-module-mocks --test
//   src/app/api/webhook/resend/route.test.ts

let verifyShouldThrow = false;
let lastVerifiedPayload: { id?: string; type?: string; data?: unknown } | null = null;
let insertCalls: unknown[][] = [];
let insertShouldThrowOnce = false;

mock.module("resend", {
  namedExports: {
    Resend: class {
      webhooks = {
        verify: (_opts: unknown) => {
          if (verifyShouldThrow) throw new Error("bad signature");
          return (
            lastVerifiedPayload ?? {
              id: "msg_default",
              type: "email.sent",
              data: { email_id: "re_1", to: ["a@example.com"], subject: "hi", created_at: "2026-10-26T00:00:00Z" },
            }
          );
        },
      };
      constructor() {}
    },
  },
});

mock.module("../../../../lib/db", {
  namedExports: {
    dbConfigured: () => true,
    dbQuery: async (_sql: string, params: unknown[]) => {
      insertCalls.push(params);
      if (insertShouldThrowOnce) {
        insertShouldThrowOnce = false;
        throw new Error("simulated db failure");
      }
      return { rows: [] };
    },
  },
});

function resetMocks() {
  verifyShouldThrow = false;
  lastVerifiedPayload = null;
  insertCalls = [];
  insertShouldThrowOnce = false;
}

function postWebhook(svixId: string, body = "{}"): Promise<Response> {
  return POST(
    new Request("https://blackouttrades.com/api/webhook/resend", {
      method: "POST",
      headers: {
        "svix-id": svixId,
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,test",
      },
      body,
    })
  );
}

let POST: typeof import("./route").POST;

describe("POST /api/webhook/resend — idempotency on redelivery", () => {
  before(async () => {
    process.env.RESEND_WEBHOOK_SECRET = "test-resend-webhook-secret";
    process.env.RESEND_API_KEY = "test-resend-api-key";
    ({ POST } = await import("./route.ts"));
  });

  afterEach(() => {
    resetMocks();
  });

  test("a redelivered event (same svix-id) is NOT inserted twice", async () => {
    lastVerifiedPayload = {
      id: "msg_dup_1",
      type: "email.bounced",
      data: { email_id: "re_dup_1", to: ["b@example.com"], subject: "bounced", created_at: "2026-10-26T00:00:00Z" },
    };

    const first = await postWebhook("svix_dup_1");
    assert.equal(first.status, 200);
    const firstJson = (await first.json()) as { ok: boolean; duplicate?: boolean };
    assert.equal(firstJson.ok, true);
    assert.equal(firstJson.duplicate, undefined, "first delivery must not be reported as a duplicate");
    assert.equal(insertCalls.length, 1, "first delivery must insert exactly one row");

    // Svix redelivers the SAME event: same svix-id, same payload.
    const second = await postWebhook("svix_dup_1");
    assert.equal(second.status, 200);
    const secondJson = (await second.json()) as { ok: boolean; duplicate?: boolean };
    assert.equal(secondJson.ok, true);
    assert.equal(secondJson.duplicate, true, "redelivery must be acked as a duplicate");
    assert.equal(insertCalls.length, 1, "redelivery must NOT insert a second row");
  });

  test("two different svix-ids each insert their own row (not over-deduped)", async () => {
    lastVerifiedPayload = {
      id: "msg_a",
      type: "email.delivered",
      data: { email_id: "re_a", to: ["c@example.com"] },
    };
    const a = await postWebhook("svix_distinct_a");
    assert.equal((await a.json() as { duplicate?: boolean }).duplicate, undefined);

    lastVerifiedPayload = {
      id: "msg_b",
      type: "email.delivered",
      data: { email_id: "re_b", to: ["d@example.com"] },
    };
    const b = await postWebhook("svix_distinct_b");
    assert.equal((await b.json() as { duplicate?: boolean }).duplicate, undefined);

    assert.equal(insertCalls.length, 2, "two distinct deliveries must both insert");
  });

  test("a retry AFTER a failed insert is reprocessed, not swallowed as a duplicate", async () => {
    lastVerifiedPayload = {
      id: "msg_retry",
      type: "email.complained",
      data: { email_id: "re_retry", to: ["e@example.com"] },
    };
    insertShouldThrowOnce = true;

    const failed = await postWebhook("svix_retry_1");
    assert.equal(failed.status, 500, "the first (failing) attempt must surface a 500 so Svix retries");
    assert.equal(insertCalls.length, 1, "the failed attempt still tried to insert once");

    // Svix retries the SAME event (same svix-id) after the 500 above.
    const retried = await postWebhook("svix_retry_1");
    assert.equal(retried.status, 200, "the retry must actually be reprocessed, not silently ack'd");
    const retriedJson = (await retried.json()) as { ok: boolean; duplicate?: boolean };
    assert.equal(retriedJson.duplicate, undefined, "retry-after-failure must not read as a duplicate");
    assert.equal(insertCalls.length, 2, "the retry must insert the row the failed attempt never persisted");
  });
});
