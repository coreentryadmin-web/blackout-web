import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuardedDashboardLoad } from "./admin-api-dashboard-request-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Regression for AdminApiDashboard.tsx: a periodic poll's load() call (8s
// telemetry tick or 120s probe tick) can already be in flight when the
// admin clicks "Rescan codebase" or "Probe providers", which fires its own
// load() call. Nothing previously stopped the EARLIER poll's response from
// resolving AFTER the LATER manual call's response and overwriting the
// dashboard with stale pre-rescan data — visibly reverting the refresh the
// admin just triggered. This models exactly that: the poll's load() starts
// first but is the slow one; the manual rescan's load() starts second,
// supersedes it, and resolves first; the poll's response only arrives after
// the rescan's fresher data already rendered.
test("runGuardedDashboardLoad drops a poll response superseded by a manual rescan/probe load", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const pollLoad = deferred<string>();
  const p1 = runGuardedDashboardLoad(
    1,
    () => latestRequestId,
    () => pollLoad.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const rescanLoad = deferred<string>();
  const p2 = runGuardedDashboardLoad(
    2,
    () => latestRequestId,
    () => rescanLoad.promise,
    (r) => applied.push(r)
  );

  // Resolve OUT OF ORDER: the newer (post-rescan) load's response arrives
  // first; the older poll's stale pre-rescan response arrives after it.
  rescanLoad.resolve("post-rescan dashboard payload");
  await p2;
  pollLoad.resolve("stale pre-rescan dashboard payload");
  await p1;

  assert.deepEqual(
    applied,
    ["post-rescan dashboard payload"],
    "the stale poll response must never overwrite the fresher rescan payload already applied"
  );
});

test("runGuardedDashboardLoad applies the response when it is still the latest load() call", async () => {
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const load1 = deferred<string>();
  const p1 = runGuardedDashboardLoad(
    1,
    () => latestRequestId,
    () => load1.promise,
    (r) => applied.push(r)
  );
  load1.resolve("only payload");
  await p1;

  assert.deepEqual(applied, ["only payload"]);
});

test("runGuardedDashboardLoad applies a response that resolves last when it IS the latest load() call", async () => {
  // Same out-of-order resolution shape as the first test, but this time the
  // second load() call is the one that resolves LAST and is still the
  // latest — it must still be applied (the guard only drops SUPERSEDED
  // calls, not merely "not first to resolve").
  let latestRequestId = 0;
  const applied: string[] = [];

  latestRequestId = 1;
  const load1 = deferred<string>();
  const p1 = runGuardedDashboardLoad(
    1,
    () => latestRequestId,
    () => load1.promise,
    (r) => applied.push(r)
  );

  latestRequestId = 2;
  const load2 = deferred<string>();
  const p2 = runGuardedDashboardLoad(
    2,
    () => latestRequestId,
    () => load2.promise,
    (r) => applied.push(r)
  );

  load1.resolve("stale payload");
  await p1;
  load2.resolve("fresh payload");
  await p2;

  assert.deepEqual(applied, ["fresh payload"]);
});
