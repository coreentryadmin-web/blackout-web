import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression: resend.emails.send() has no built-in timeout (confirmed in the installed SDK —
// Emails.send/create -> Resend.post -> fetchRequest just does a plain fetch(url, options) with
// whatever `options` the caller passes), so a hung Resend connection left the call pending
// indefinitely. That mattered most for email-capture/route.ts, which awaits sendEmail() before
// responding to an UNAUTHENTICATED caller. Fixed by passing an AbortSignal.timeout() as the
// send() call's second argument, which the SDK forwards straight into fetch()'s options.

let sendCalls: Array<{ payload: unknown; options: unknown }> = [];

mock.module("resend", {
  namedExports: {
    Resend: class {
      emails = {
        send: async (payload: unknown, options: unknown) => {
          sendCalls.push({ payload, options });
          return { data: { id: "test-id" }, error: null };
        },
      };
      constructor() {}
    },
  },
});

function resetMocks() {
  sendCalls = [];
}

test("sendEmail passes an AbortSignal timeout to resend.emails.send", async () => {
  resetMocks();
  process.env.RESEND_API_KEY = "test-key";

  const { sendEmail } = await import("./resend-client.ts");
  const result = await sendEmail({ to: "a@example.com", subject: "s", html: "<p>h</p>" });

  assert.equal(result.ok, true);
  assert.equal(sendCalls.length, 1);
  const options = sendCalls[0]?.options as { signal?: AbortSignal } | undefined;
  assert.ok(options?.signal, "send() must be called with a signal option");
  assert.ok(options.signal instanceof AbortSignal, "the signal must be a real AbortSignal");
});
