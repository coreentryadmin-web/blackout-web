import { test } from "node:test";
import assert from "node:assert/strict";
import { loadXIntelRowIfCurrent } from "./x-intel-row-race-guard";

/**
 * Regression (DISCOVERY sweep, round 236): the X-Intel queue detail page
 * (`/admin/x-intel/[id]`) keyed its row fetch on the route's `[id]` param with a bare
 * `fetchRow().then(setRow)` and no guard against out-of-order resolution. The App Router does
 * NOT remount this page when navigating between two sibling detail routes, so opening row 123
 * then quickly clicking into row 456 before 123's request resolved left two fetches in flight.
 * If 123's (slower) response landed AFTER 456's, its bare `setRow(found)` would silently
 * repaint the page with row 123's headline/post-copy/tweet-ID form while the URL and page
 * title still said 456 — and submitting the "record tweet ID" form from there would attach
 * the pasted tweet ID to the WRONG queue cycle. Same bug class as `AdminApiEventDetail`'s
 * `loadEventDetailIfCurrent` (round 121); `loadXIntelRowIfCurrent` is this page's version of
 * that guard — it only applies a response (success OR error) when the id it was fetched for is
 * still the latest one requested.
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("loadXIntelRowIfCurrent: an earlier request resolving AFTER a later one is ignored (stale), not applied", async () => {
  const a = deferred<{ id: string }>();
  const b = deferred<{ id: string }>();

  let latest: string | null = "123";
  const applied: Array<{ id: string }> = [];
  const settledIds: string[] = [];

  // Admin opens row 123 — its request starts first (latest is still "123").
  const runA = loadXIntelRowIfCurrent(
    "123",
    () => a.promise,
    () => latest,
    (d) => applied.push(d),
    () => {},
    () => settledIds.push("123")
  );

  // Before 123's fetch resolves, the admin clicks into row 456 — a second request starts and
  // "latest" moves on.
  latest = "456";
  const runB = loadXIntelRowIfCurrent(
    "456",
    () => b.promise,
    () => latest,
    (d) => applied.push(d),
    () => {},
    () => settledIds.push("456")
  );

  // 456's (faster) response lands first…
  b.resolve({ id: "456" });
  await runB;
  // …then 123's slower, now-stale response lands.
  a.resolve({ id: "123" });
  await runA;

  assert.deepEqual(
    applied,
    [{ id: "456" }],
    "the stale row-123 response must never be applied once 456 is the latest requested id"
  );
  assert.deepEqual(
    settledIds,
    ["456"],
    "a stale request's onSettled (loading=false) must also be skipped so it can't clear a newer request's loading state"
  );
});

test("loadXIntelRowIfCurrent: a stale request's ERROR is also dropped, not applied over newer data", async () => {
  const a = deferred<never>();
  const b = deferred<{ id: string }>();

  let latest: string | null = "123";
  const applied: Array<{ id: string }> = [];
  const errors: string[] = [];

  const runA = loadXIntelRowIfCurrent<{ id: string }>(
    "123",
    () => a.promise,
    () => latest,
    (d) => applied.push(d),
    (msg) => errors.push(msg),
    () => {}
  );

  latest = "456";
  const runB = loadXIntelRowIfCurrent<{ id: string }>(
    "456",
    () => b.promise,
    () => latest,
    (d) => applied.push(d),
    (msg) => errors.push(msg),
    () => {}
  );

  b.resolve({ id: "456" });
  await runB;
  // Row 123's request fails AFTER 456 already loaded successfully — must not blow away the
  // now-current 456 view with a "Row not found" error for a page nobody is looking at anymore.
  a.reject(new Error("Row not found"));
  await runA;

  assert.deepEqual(applied, [{ id: "456" }]);
  assert.deepEqual(errors, [], "a superseded request's error must never surface once a newer id has loaded");
});

test("loadXIntelRowIfCurrent: the only request in flight is always applied (no false negatives)", async () => {
  const latest = "123";
  const applied: unknown[] = [];
  await loadXIntelRowIfCurrent(
    "123",
    async () => ({ id: "123" }),
    () => latest,
    (d) => applied.push(d),
    () => {},
    () => {}
  );
  assert.deepEqual(applied, [{ id: "123" }]);
});
