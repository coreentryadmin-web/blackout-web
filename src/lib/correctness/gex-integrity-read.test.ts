import assert from "node:assert/strict";
import test from "node:test";
import { readGexPositioningWithRetryForIntegrity } from "@/lib/correctness/gex-integrity-read";

test("readGexPositioningWithRetryForIntegrity: retries until success", async () => {
  let calls = 0;
  const pos = await readGexPositioningWithRetryForIntegrity("SPX", async () => {
    calls += 1;
    if (calls < 3) return null;
    return { spot: 5000 };
  });
  assert.ok(pos);
  assert.equal(calls, 3);
});

test("readGexPositioningWithRetryForIntegrity: returns null after exhausted attempts", async () => {
  const pos = await readGexPositioningWithRetryForIntegrity("SPY", async () => null);
  assert.equal(pos, null);
});
