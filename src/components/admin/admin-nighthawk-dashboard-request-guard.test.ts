import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuardedNighthawkLoad } from "./admin-nighthawk-dashboard-request-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Regression for the admin Night Hawk dashboard: switching the window-range
// tabs (7d/30d/90d) re-runs `load()` without canceling a still-in-flight
// earlier call. This models exactly that: request 1 ("7d") starts first but
// is the slow one; request 2 ("30d") starts second, supersedes it, and
// resolves first; request 1's response only arrives after request 2's
// already rendered. Before this guard existed, `load()` called
// `setData(...)` unconditionally on every resolution, so the 7d response
// would have clobbered the already-rendered 30d numbers.
test("runGuardedNighthawkLoad drops a response whose request has since been superseded", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedNighthawkLoad(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const req2 = deferred<string>();
  const p2 = runGuardedNighthawkLoad(
    2,
    () => latestRequestId,
    () => req2.promise,
    (r) => applied.push(r)
  );

  // Resolve OUT OF ORDER: the newer ("30d") request's response arrives
  // first; the older, slower ("7d") request's response arrives after it.
  req2.resolve("30d metrics");
  await p2;
  req1.resolve("7d metrics");
  await p1;

  assert.deepEqual(
    applied,
    ["30d metrics"],
    "the stale 7d response must never overwrite the 30d metrics already applied"
  );
});

test("runGuardedNighthawkLoad applies the response when it is still the latest request", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedNighthawkLoad(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );
  req1.resolve("only metrics");
  await p1;

  assert.deepEqual(applied, ["only metrics"]);
});

test("runGuardedNighthawkLoad applies a response that resolves last when it IS the latest request", async () => {
  // Same out-of-order resolution shape as the first test, but this time
  // request 2 is the one that resolves LAST and is still the latest — it
  // must still be applied (the guard only drops SUPERSEDED requests, not
  // merely "not first to resolve").
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedNighthawkLoad(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const req2 = deferred<string>();
  const p2 = runGuardedNighthawkLoad(
    2,
    () => latestRequestId,
    () => req2.promise,
    (r) => applied.push(r)
  );

  req1.resolve("7d metrics");
  await p1;
  req2.resolve("30d metrics");
  await p2;

  assert.deepEqual(applied, ["30d metrics"]);
});
