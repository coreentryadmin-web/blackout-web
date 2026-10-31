import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuardedAuditLoad } from "./admin-operations-audit-request-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Regression for AdminOperationsDashboard.tsx's Audit Trail panel: typing in
// the "Action"/"Actor" filter boxes fires a new, un-debounced loadAudit()
// request on every keystroke, and the 30s background poll can ALSO have one
// in flight at the same time. Nothing previously stopped an EARLIER, slower
// request's response from resolving AFTER a LATER, faster request's response
// and overwriting the admin's screen with stale audit rows. This models
// exactly that: request 1 ("AAP" filter) starts first but is the slow one;
// request 2 ("AAPL" filter) starts second, supersedes it, and resolves
// first; request 1's response only arrives after request 2's already
// rendered.
test("runGuardedAuditLoad drops a response whose request has since been superseded", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedAuditLoad(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const req2 = deferred<string>();
  const p2 = runGuardedAuditLoad(
    2,
    () => latestRequestId,
    () => req2.promise,
    (r) => applied.push(r)
  );

  // Resolve OUT OF ORDER: the newer ("AAPL") request's response arrives
  // first; the older, slower ("AAP") request's response arrives after it.
  req2.resolve("AAPL audit rows");
  await p2;
  req1.resolve("AAP audit rows");
  await p1;

  assert.deepEqual(
    applied,
    ["AAPL audit rows"],
    "the stale AAP response must never overwrite the AAPL audit rows already applied"
  );
});

test("runGuardedAuditLoad applies the response when it is still the latest request", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedAuditLoad(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );
  req1.resolve("only audit rows");
  await p1;

  assert.deepEqual(applied, ["only audit rows"]);
});

test("runGuardedAuditLoad applies a response that resolves last when it IS the latest request", async () => {
  // Same out-of-order resolution shape as the first test, but this time
  // request 2 is the one that resolves LAST and is still the latest — it
  // must still be applied (the guard only drops SUPERSEDED requests, not
  // merely "not first to resolve").
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const req1 = deferred<string>();
  const p1 = runGuardedAuditLoad(
    1,
    () => latestRequestId,
    () => req1.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const req2 = deferred<string>();
  const p2 = runGuardedAuditLoad(
    2,
    () => latestRequestId,
    () => req2.promise,
    (r) => applied.push(r)
  );

  req1.resolve("AAP audit rows");
  await p1;
  req2.resolve("AAPL audit rows");
  await p2;

  assert.deepEqual(applied, ["AAPL audit rows"]);
});

// A background poll tick (no filter change) racing a manual filter-change
// request is the same shape — the poll just happens to be request 1 here.
test("runGuardedAuditLoad drops a stale background-poll response that resolves after a filter change", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const pollLoad = deferred<string>();
  const p1 = runGuardedAuditLoad(
    1,
    () => latestRequestId,
    () => pollLoad.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const filterLoad = deferred<string>();
  const p2 = runGuardedAuditLoad(
    2,
    () => latestRequestId,
    () => filterLoad.promise,
    (r) => applied.push(r)
  );

  filterLoad.resolve("filtered audit rows");
  await p2;
  pollLoad.resolve("unfiltered poll audit rows");
  await p1;

  assert.deepEqual(
    applied,
    ["filtered audit rows"],
    "the stale poll response must never overwrite the filtered audit rows already applied"
  );
});
