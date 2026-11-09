import assert from "node:assert/strict";
import test from "node:test";

import { isTransientHttpStatus, withTransientRetry } from "./gha-transient-http.mjs";

test("isTransientHttpStatus: gateway errors", () => {
  assert.equal(isTransientHttpStatus(502), true);
  assert.equal(isTransientHttpStatus(503), true);
  assert.equal(isTransientHttpStatus(200), false);
  assert.equal(isTransientHttpStatus(401), false);
});

test("withTransientRetry: stops on non-retryable result", async () => {
  let calls = 0;
  const value = await withTransientRetry(
    async () => {
      calls += 1;
      return { status: 200 };
    },
    { shouldRetry: (r) => isTransientHttpStatus(r.status), attempts: 4, delayMs: 1 }
  );
  assert.equal(value.status, 200);
  assert.equal(calls, 1);
});

test("withTransientRetry: retries transient then succeeds", async () => {
  let calls = 0;
  const value = await withTransientRetry(
    async () => {
      calls += 1;
      return { status: calls < 3 ? 502 : 200 };
    },
    { shouldRetry: (r) => isTransientHttpStatus(r.status), attempts: 5, delayMs: 1 }
  );
  assert.equal(value.status, 200);
  assert.equal(calls, 3);
});
