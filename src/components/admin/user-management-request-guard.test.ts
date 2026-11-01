import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuardedUsersFetch, applyUserDetailIfCurrent } from "./user-management-request-guard";

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

// Regression for the admin User Management DETAIL PANEL: `openUserDetail` used to be a bare
// `fetch(...).then(setSelectedUser)` with no guard at all. Clicking user row A then user row B
// before A's (slower) response arrives starts a second, independent fetch — if A's response
// resolves AFTER B's, nothing stopped `setSelectedUser(A's data)` from firing last and silently
// swapping the open panel from B back to A while the admin is looking at B's tools/billing/role
// controls. Models exactly that out-of-order resolution.
test("applyUserDetailIfCurrent drops user A's late response once user B's panel is open", async () => {
  let currentUserId: string | null = null;
  const applied: string[] = [];

  currentUserId = "user-A";
  const reqA = deferred<{ id: string } | null>();
  const pA = applyUserDetailIfCurrent(
    "user-A",
    () => reqA.promise,
    () => currentUserId,
    (d) => applied.push(d.id)
  );

  // Admin clicks row B before A's response arrives.
  currentUserId = "user-B";
  const reqB = deferred<{ id: string } | null>();
  const pB = applyUserDetailIfCurrent(
    "user-B",
    () => reqB.promise,
    () => currentUserId,
    (d) => applied.push(d.id)
  );

  // B resolves first (fast); A resolves after it (slow) — the out-of-order case.
  reqB.resolve({ id: "user-B" });
  await pB;
  reqA.resolve({ id: "user-A" });
  await pA;

  assert.deepEqual(
    applied,
    ["user-B"],
    "user A's stale response must never reopen/overwrite the already-open user B panel"
  );
});

test("applyUserDetailIfCurrent applies the response when its user is still the open panel", async () => {
  let currentUserId: string | null = null;
  const applied: string[] = [];

  currentUserId = "user-A";
  const reqA = deferred<{ id: string } | null>();
  const pA = applyUserDetailIfCurrent(
    "user-A",
    () => reqA.promise,
    () => currentUserId,
    (d) => applied.push(d.id)
  );
  reqA.resolve({ id: "user-A" });
  await pA;

  assert.deepEqual(applied, ["user-A"]);
});

// `syncWhop`'s own post-sync detail refresh races the SAME `openUserDetail` calls: it starts a
// fetch for whichever user was selected when Sync was clicked, and must not reopen/overwrite a
// DIFFERENT user's panel the admin opened while that refresh was still in flight.
test("applyUserDetailIfCurrent drops a stale syncWhop refresh once a different user's panel is open", async () => {
  let currentUserId: string | null = "user-A";
  const applied: string[] = [];

  // syncWhop's refresh for the currently-selected user A starts...
  const refresh = deferred<{ id: string; synced: true } | null>();
  const pRefresh = applyUserDetailIfCurrent(
    "user-A",
    () => refresh.promise,
    () => currentUserId,
    (d) => applied.push(`${d.id}:synced`)
  );

  // ...then, before it resolves, the admin opens user B's panel instead.
  currentUserId = "user-B";

  refresh.resolve({ id: "user-A", synced: true });
  await pRefresh;

  assert.deepEqual(
    applied,
    [],
    "a sync refresh for a user who is no longer the open panel must never overwrite the new selection"
  );
});

// Closing the panel entirely (getCurrentUserId -> null) mid-flight is the same race in a
// different guise — a stale response must not silently reopen a panel the admin dismissed.
test("applyUserDetailIfCurrent drops the response when the panel has since been closed", async () => {
  let currentUserId: string | null = "user-A";
  const applied: string[] = [];

  const req = deferred<{ id: string } | null>();
  const p = applyUserDetailIfCurrent(
    "user-A",
    () => req.promise,
    () => currentUserId,
    (d) => applied.push(d.id)
  );

  currentUserId = null; // panel closed while the fetch was in flight
  req.resolve({ id: "user-A" });
  await p;

  assert.deepEqual(applied, [], "a closed panel must not be reopened by a late response");
});
