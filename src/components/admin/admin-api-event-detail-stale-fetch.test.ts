import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEventDetailIfCurrent } from "./AdminApiEventDetail";

/**
 * Regression (DISCOVERY sweep, round 121): AdminApiEventDetail's detail-fetch effect used to be
 * a bare `fetch(...).then(setDetail)` keyed on `eventId`, with no guard against an EARLIER,
 * slower request resolving AFTER a LATER one. Clicking event A, then clicking event B before
 * A's request finished, started a second in-flight fetch for B without cancelling or ignoring
 * A's — if A's response happened to land after B's, A's `.then(setDetail)` fired last and
 * silently clobbered the drawer with the wrong event's forensics while it was still titled/keyed
 * for B. `loadEventDetailIfCurrent` is the extracted, pure-enough-to-test guard: it only applies
 * a response when the id it was fetched for is STILL the latest requested id.
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("loadEventDetailIfCurrent: an earlier request resolving AFTER a later one is ignored (stale), not applied", async () => {
  const a = deferred<{ id: string }>();
  const b = deferred<{ id: string }>();
  const fetchFn = (id: string) => (id === "A" ? a.promise : b.promise);

  let latest: string | null = "A";
  const applied: Array<{ id: string }> = [];
  const settledIds: string[] = [];

  // Request A starts first (latest is still "A" at this point).
  const runA = loadEventDetailIfCurrent("A", fetchFn, () => latest, (d) => applied.push(d), () =>
    settledIds.push("A")
  );

  // Before A resolves, the admin clicks event B — a second request starts and "latest" moves on.
  latest = "B";
  const runB = loadEventDetailIfCurrent("B", fetchFn, () => latest, (d) => applied.push(d), () =>
    settledIds.push("B")
  );

  // B's (faster) response lands first…
  b.resolve({ id: "B" });
  await runB;
  // …then A's slower, now-stale response lands.
  a.resolve({ id: "A" });
  await runA;

  assert.deepEqual(
    applied,
    [{ id: "B" }],
    "the stale A response must never be applied once B is the latest request — only B's data should ever reach the drawer"
  );
  assert.deepEqual(
    settledIds,
    ["B"],
    "a stale request's onSettled (loading=false) must also be skipped so it can't clear a newer request's loading state"
  );
});

test("loadEventDetailIfCurrent: the only request in flight is always applied (no false negatives)", async () => {
  let latest: string | null = "A";
  const applied: unknown[] = [];
  await loadEventDetailIfCurrent(
    "A",
    async (id) => ({ id }),
    () => latest,
    (d) => applied.push(d),
    () => {}
  );
  assert.deepEqual(applied, [{ id: "A" }]);
});

test("loadEventDetailIfCurrent: a request for a since-closed drawer (latest=null) is dropped", async () => {
  let latest: string | null = "A";
  const applied: unknown[] = [];
  const settled: string[] = [];
  const p = loadEventDetailIfCurrent(
    "A",
    async (id) => ({ id }),
    () => latest,
    (d) => applied.push(d),
    () => settled.push("done")
  );
  latest = null; // drawer closed while the fetch was in flight
  await p;
  assert.deepEqual(applied, [], "closing the drawer before the fetch resolves must not repopulate it");
  assert.deepEqual(settled, []);
});
