import { test } from "node:test";
import assert from "node:assert/strict";
import { runWithDeadlockRetry, POSTGRES_DEADLOCK_DETECTED } from "./deadlock-retry";

function deadlockErr(): Error & { code: string } {
  const err = new Error("deadlock detected") as Error & { code: string };
  err.code = POSTGRES_DEADLOCK_DETECTED;
  return err;
}

test("succeeds immediately when the first attempt does not throw", async () => {
  let calls = 0;
  const result = await runWithDeadlockRetry(async () => {
    calls++;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("retries a deadlock (40P01) and returns the eventual success", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await runWithDeadlockRetry(
    async () => {
      calls++;
      if (calls < 3) throw deadlockErr();
      return 42;
    },
    { sleep: async (ms) => { sleeps.push(ms); } }
  );
  assert.equal(result, 42);
  assert.equal(calls, 3, "must have retried twice before succeeding on the 3rd attempt");
  assert.deepEqual(sleeps, [100, 200], "backoff must grow with attempt number (default baseDelayMs=100)");
});

test("gives up after maxRetries and rethrows the last deadlock error", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runWithDeadlockRetry(
        async () => {
          calls++;
          throw deadlockErr();
        },
        { maxRetries: 2, sleep: async () => {} }
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as { code?: string }).code, POSTGRES_DEADLOCK_DETECTED);
      return true;
    }
  );
  assert.equal(calls, 3, "1 original attempt + 2 retries = 3 total calls, never a 4th");
});

test("a NON-deadlock error is rethrown immediately, on the first attempt, never retried", async () => {
  let calls = 0;
  const otherErr = new Error("undefined_table") as Error & { code: string };
  otherErr.code = "42P01";
  await assert.rejects(
    () =>
      runWithDeadlockRetry(
        async () => {
          calls++;
          throw otherErr;
        },
        { sleep: async () => {
          throw new Error("must not sleep/retry on a non-deadlock error");
        } }
      ),
    /undefined_table/
  );
  assert.equal(calls, 1, "a non-deadlock error must not be retried at all");
});

test("an error with no .code at all is treated as non-deadlock and rethrown immediately", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runWithDeadlockRetry(async () => {
        calls++;
        throw new Error("plain error, no pg code");
      }),
    /plain error/
  );
  assert.equal(calls, 1);
});

test("onRetry fires once per retry with a 1-indexed attempt number", async () => {
  let calls = 0;
  const seen: number[] = [];
  await runWithDeadlockRetry(
    async () => {
      calls++;
      if (calls < 3) throw deadlockErr();
      return "done";
    },
    { sleep: async () => {}, onRetry: (attempt) => seen.push(attempt) }
  );
  assert.deepEqual(seen, [1, 2]);
});
