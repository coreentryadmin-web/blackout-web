import assert from "node:assert/strict";
import test from "node:test";
import { withLiveTransportRetries } from "./largo-stress-live-transport.mjs";

test("withLiveTransportRetries returns SKIP-shaped 503 after exhausted ECONNRESET", async () => {
  let calls = 0;
  const out = await withLiveTransportRetries(
    async () => {
      calls += 1;
      const err = new TypeError("fetch failed");
      err.cause = { code: "ECONNRESET" };
      throw err;
    },
    { attempts: 2, backoffMs: () => 0 }
  );
  assert.equal(calls, 2);
  assert.equal(out.status, 503);
  assert.equal(out.transport_failed, true);
  assert.equal(out.transport_error, "ECONNRESET");
});

test("withLiveTransportRetries retries 429 then returns success", async () => {
  let calls = 0;
  const out = await withLiveTransportRetries(
    async () => {
      calls += 1;
      if (calls === 1) return { status: 429, answer: "", ms: 1 };
      return { status: 200, answer: "ok", ms: 2 };
    },
    { attempts: 3, backoffMs: () => 0 }
  );
  assert.equal(out.status, 200);
  assert.equal(out.answer, "ok");
});

test("withLiveTransportRetries marks throttled when all attempts are 429", async () => {
  const out = await withLiveTransportRetries(async () => ({ status: 429, answer: "", ms: 1 }), {
    attempts: 2,
    backoffMs: () => 0,
  });
  assert.equal(out.status, 429);
  assert.equal(out.throttled, true);
});
