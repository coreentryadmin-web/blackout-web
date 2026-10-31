import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuardedXIntelQueueLoad } from "./x-intel-queue-request-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Regression for the admin X Intel Queue panel: switching the status filter
// (ALL -> SKIP) fires a new load() while the 120s background poll's own
// in-flight request for the PREVIOUS filter is still pending. Nothing
// previously stopped that earlier, slower "ALL" response from resolving
// AFTER the later, filter-driven "SKIP" response and overwriting the table
// with the wrong filter's rows while the dropdown still showed "Skip"
// selected. This models exactly that: request 1 ("ALL") starts first but is
// the slow one; request 2 ("SKIP") starts second, supersedes it, and
// resolves first; request 1's response only arrives after request 2's
// already rendered.
test("runGuardedXIntelQueueLoad drops a response whose request has since been superseded", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedXIntelQueueLoad(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const req2 = deferred<string>();
  const p2 = runGuardedXIntelQueueLoad(
    2,
    () => latestRequestId,
    () => req2.promise,
    (r) => applied.push(r)
  );

  // Resolve OUT OF ORDER: the newer ("SKIP") request's response arrives
  // first; the older, slower ("ALL") poll response arrives after it.
  req2.resolve("SKIP rows");
  await p2;
  req1.resolve("ALL rows");
  await p1;

  assert.deepEqual(
    applied,
    ["SKIP rows"],
    "the stale ALL-filter response must never overwrite the SKIP rows already applied"
  );
});

test("runGuardedXIntelQueueLoad applies the response when it is still the latest request", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedXIntelQueueLoad(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );
  req1.resolve("only results");
  await p1;

  assert.deepEqual(applied, ["only results"]);
});

test("runGuardedXIntelQueueLoad applies a response that resolves last when it IS the latest request", async () => {
  // Same out-of-order resolution shape as the first test, but this time
  // request 2 is the one that resolves LAST and is still the latest — it
  // must still be applied (the guard only drops SUPERSEDED requests, not
  // merely "not first to resolve").
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedXIntelQueueLoad(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const req2 = deferred<string>();
  const p2 = runGuardedXIntelQueueLoad(
    2,
    () => latestRequestId,
    () => req2.promise,
    (r) => applied.push(r)
  );

  req1.resolve("ALL rows");
  await p1;
  req2.resolve("SKIP rows");
  await p2;

  assert.deepEqual(applied, ["SKIP rows"]);
});
