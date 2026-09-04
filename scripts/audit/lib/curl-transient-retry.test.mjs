import test from "node:test";
import assert from "node:assert/strict";
import { isTransientCurlFailure, withTransientRetry } from "./curl-transient-retry.mjs";

test("isTransientCurlFailure: HTTP 200 is not transient", () => {
  assert.equal(isTransientCurlFailure({ s: 200 }), false);
});

test("isTransientCurlFailure: curl connection reset is transient", () => {
  assert.equal(
    isTransientCurlFailure({ s: 0, err: "Command failed: curl: (35) Recv failure: Connection reset by peer" }),
    true,
  );
});

test("withTransientRetry: succeeds after transient failure", async () => {
  let n = 0;
  const r = await withTransientRetry(() => {
    n += 1;
    return n < 2 ? { s: 0, err: "Connection reset" } : { s: 200, b: "ok" };
  }, { attempts: 3, baseDelayMs: 1 });
  assert.equal(r.s, 200);
  assert.equal(n, 2);
});
