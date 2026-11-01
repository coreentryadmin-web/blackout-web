import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableFetchError, isRetryableStatus } from "./fetch-retry.mjs";

test("isRetryableFetchError: ECONNRESET and fetch failed message", () => {
  assert.equal(isRetryableFetchError({ code: "ECONNRESET" }), true);
  assert.equal(isRetryableFetchError({ message: "fetch failed", cause: { code: "ECONNRESET" } }), true);
  assert.equal(isRetryableFetchError({ message: "TypeError: fetch failed" }), true);
  assert.equal(isRetryableFetchError(new Error("something else")), false);
});

test("isRetryableStatus: 429 and 5xx", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(200), false);
});
