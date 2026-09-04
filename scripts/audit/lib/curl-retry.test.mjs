import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableCurlResult, curlWithRetry } from "./curl-retry.mjs";

test("isRetryableCurlResult flags connection reset", () => {
  assert.equal(
    isRetryableCurlResult({ s: 0, err: "Command failed: curl: (35) Recv failure: Connection reset by peer" }),
    true,
  );
});

test("isRetryableCurlResult flags 502", () => {
  assert.equal(isRetryableCurlResult({ s: 502, b: "" }), true);
});

test("isRetryableCurlResult ignores 404", () => {
  assert.equal(isRetryableCurlResult({ s: 404, b: "not found" }), false);
});

test("curlWithRetry retries then succeeds", () => {
  let calls = 0;
  const out = curlWithRetry(
    () => {
      calls++;
      if (calls < 3) return { s: 0, err: "connection reset by peer" };
      return { s: 200, b: "ok" };
    },
    {},
    { retries: 4, baseDelayMs: 1 },
  );
  assert.equal(calls, 3);
  assert.equal(out.s, 200);
});

test("curlWithRetry exhausts retries", () => {
  let calls = 0;
  const out = curlWithRetry(
    () => {
      calls++;
      return { s: 0, err: "connection reset by peer" };
    },
    {},
    { retries: 2, baseDelayMs: 1 },
  );
  assert.equal(calls, 3);
  assert.equal(out.s, 0);
});
