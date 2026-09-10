import { test } from "node:test";
import assert from "node:assert/strict";
import { runSseTickSafely } from "./sse-safe-tick";

// A production crash-level alert (2026-09-09, twice in ~20 minutes) showed an unhandled
// promise rejection escaping vector/stream's fire-and-forget `void send()` tick, rooted
// in sse-stream-entitlement.ts's recheckSseUserEntitlement re-throwing any non-degraded-
// mode failure (a genuine Clerk/Redis error, not just "unavailable"). Nothing in the
// `void send()` chain had a `.catch()` anywhere. runSseTickSafely is the fix: it must
// never let a wrapped tick's rejection escape, no matter what throws.

test("runSseTickSafely: an unexpected throw does not reject — it resolves after logging", async () => {
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    await assert.doesNotReject(() =>
      runSseTickSafely(async () => {
        throw new Error("simulated recheckSseUserEntitlement re-throw");
      }, "test-route"),
    );
    assert.equal(logged.length, 1);
    assert.match(String(logged[0][0]), /\[sse-stream:test-route\] tick failed unexpectedly:/);
  } finally {
    console.error = originalError;
  }
});

test("runSseTickSafely: a rejected promise (not just a thrown sync error) is also swallowed", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.doesNotReject(() =>
      runSseTickSafely(() => Promise.reject(new Error("async rejection")), "test-route"),
    );
  } finally {
    console.error = originalError;
  }
});

test("runSseTickSafely: a successful tick runs through untouched, no logging", async () => {
  const originalError = console.error;
  let loggedCount = 0;
  console.error = () => {
    loggedCount += 1;
  };
  let ran = false;
  try {
    await runSseTickSafely(async () => {
      ran = true;
    }, "test-route");
  } finally {
    console.error = originalError;
  }
  assert.equal(ran, true);
  assert.equal(loggedCount, 0);
});
