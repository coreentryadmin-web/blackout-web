// Regression: db-cleanup must not let a second/third concurrent invocation of itself run the
// batched-DELETE loop at the same time, and a single batch's Postgres deadlock must not fail the
// whole nightly prune.
//
// Root-caused 2026-09-12: a live "Cron failure: db-cleanup" alert traced to Postgres `deadlock
// detected` (40P01) pruning `vector_wall_history` at 07:04:14 UTC. CloudWatch confirmed this
// route's own BIE-ingest log line (one call per request) firing THREE times within ~4 minutes
// that night — i.e. the same batched-DELETE loop running concurrently with itself, most likely
// because `hit-cron` (blackout-infra's EventBridge->Lambda fetch shim) treats this route's 500 as
// a failed invocation and AWS retries it. Concurrent invocations of the same loop racing for row
// locks across ~26 shared tables is an ordinary way to deadlock on its own.
//
// Text-based source assertions, same pattern as vector-pick-sweep/route.test.ts (that cron's own
// overlap-lock regression test) — the route imports `next/server` and talks to Postgres/Redis, so
// asserting on the actual source is the pragmatic way to pin these invariants without a full
// Next.js request/DB mock harness.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("db-cleanup acquires a cross-invocation overlap lock before running the prune", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before runCleanup(), not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
  // The lock must be acquired BEFORE runCleanup() is ever called, and the skip branch must
  // return before reaching it.
  const acquireIdx = routeSrc.indexOf("const acquired = await sharedCacheSetNx(");
  const runCleanupCallIdx = routeSrc.indexOf("await runCleanup()");
  assert.ok(acquireIdx > 0 && runCleanupCallIdx > 0 && acquireIdx < runCleanupCallIdx);
});

test("a lost overlap-lock race returns a skip response instead of running a second prune", () => {
  assert.match(routeSrc, /reason: "previous db-cleanup run still in flight \(idempotent skip\)"/);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the nightly prune shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,150}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future run"
  );
});

test("the lock is released in a finally block so it frees the next run on EVERY exit path (success, thrown error, or early skip return)", () => {
  const finallyBlock = /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
  // The finally must wrap the try that contains BOTH the success return and the catch's error
  // return, i.e. it must appear once, after the catch block, not duplicated per-branch.
  const finallyCount = (routeSrc.match(/await sharedCacheDel\(OVERLAP_LOCK_KEY\)/g) ?? []).length;
  assert.equal(finallyCount, 1, "exactly one release site (the finally), not one per return branch");
});

test("the lock TTL gives real margin above the route's own maxDuration (300s), so it can't expire mid-run", () => {
  assert.match(routeSrc, /export const maxDuration = 300;/);
  const match = routeSrc.match(/OVERLAP_LOCK_TTL_SEC = (\d+)/);
  assert.ok(match, "OVERLAP_LOCK_TTL_SEC must be a bare numeric literal for this check to hold");
  const ttlSec = Number(match[1]);
  assert.ok(
    ttlSec > 300,
    `TTL (${ttlSec}s) must exceed maxDuration (300s) or the lock can expire while a healthy run is still going`
  );
});

test("each cleanup batch is retried through runWithDeadlockRetry, not a bare dbQuery call", () => {
  assert.match(routeSrc, /import \{ runWithDeadlockRetry \} from "@\/lib\/deadlock-retry";/);
  assert.match(
    routeSrc,
    /await runWithDeadlockRetry\(\s*\(\)\s*=>\s*\n?\s*dbQuery\(/,
    "the batched DELETE must go through the deadlock-retry wrapper"
  );
});

test("the 42P01 (undefined_table) skip-and-self-heal behavior is unchanged by the retry wrapper", () => {
  assert.match(routeSrc, /"42P01"/);
  assert.match(routeSrc, /skipping \$\{table\}: table does not exist yet/);
});
