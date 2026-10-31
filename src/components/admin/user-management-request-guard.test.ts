import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuardedUsersFetch } from "./user-management-request-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Regression for the admin User Management search box: typing fires a new,
// un-debounced fetchUsers() request on every keystroke, and nothing
// previously stopped an EARLIER, slower request's response from resolving
// AFTER a LATER, faster request's response and overwriting the admin's
// screen with stale results. This models exactly that: request 1 ("AAP")
// starts first but is the slow one; request 2 ("AAPL") starts second,
// supersedes it, and resolves first; request 1's response only arrives
// after request 2's already rendered.
test("runGuardedUsersFetch drops a response whose request has since been superseded", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedUsersFetch(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const req2 = deferred<string>();
  const p2 = runGuardedUsersFetch(
    2,
    () => latestRequestId,
    () => req2.promise,
    (r) => applied.push(r)
  );

  // Resolve OUT OF ORDER: the newer ("AAPL") request's response arrives
  // first; the older, slower ("AAP") request's response arrives after it.
  req2.resolve("AAPL results");
  await p2;
  req1.resolve("AAP results");
  await p1;

  assert.deepEqual(
    applied,
    ["AAPL results"],
    "the stale AAP response must never overwrite the AAPL results already applied"
  );
});

test("runGuardedUsersFetch applies the response when it is still the latest request", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedUsersFetch(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );
  req1.resolve("only results");
  await p1;

  assert.deepEqual(applied, ["only results"]);
});

test("runGuardedUsersFetch applies a response that resolves last when it IS the latest request", async () => {
  // Same out-of-order resolution shape as the first test, but this time
  // request 2 is the one that resolves LAST and is still the latest — it
  // must still be applied (the guard only drops SUPERSEDED requests, not
  // merely "not first to resolve").
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedUsersFetch(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const req2 = deferred<string>();
  const p2 = runGuardedUsersFetch(
    2,
    () => latestRequestId,
    () => req2.promise,
    (r) => applied.push(r)
  );

  req1.resolve("AAP results");
  await p1;
  req2.resolve("AAPL results");
  await p2;

  assert.deepEqual(applied, ["AAPL results"]);
});
