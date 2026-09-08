// Regression: vector-full-state-snapshot must handshake via after() so Cloudflare never 504s
// the cron before logCronRun fires (ops #1355 — same class as bie-full-state-snapshot #1343).
//
// Also: vector-full-state-snapshot must not run overlapping sweeps across replicas.
//
// Measured live on prod 2026-09-02: a single sweep logged elapsed=334995ms (5m35s) against this
// cron's own 5-minute EventBridge schedule (`2-59/5 11-21 * * 1-5`, blackout-infra
// cron-jobs.json) — the in-loop TIME_BUDGET_MS=50_000 only checks the clock BETWEEN ticker
// batches, so one batch stuck behind the shared Polygon/UW rate limiters can blow the budget many
// times over. With no overlap guard, the next scheduled fire landed while the previous run was
// still in flight (derived overlap ~35s at 16:10:08-16:12:12 UTC) — both instances then competed
// for the same cluster-wide rate limiters real member requests depend on, in the same window ALB
// TargetResponseTime read p99 44-95s / Max up to 119s (CloudWatch). Same `sharedCacheSetNx`
// idempotent-skip pattern already used by vector-pick-sweep/zerodte-warm.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("vector-full-state-snapshot dispatches heavy sweep in after() and returns 202", () => {
  assert.match(routeSrc, /after\(dispatchSnapshot\)/, "must use after() for fire-and-forget handshake");
  assert.match(routeSrc, /status:\s*202/, "must return HTTP 202 accepted");
  assert.match(routeSrc, /logCronRun\("vector-full-state-snapshot"/, "must log cron handshake before response");
  assert.doesNotMatch(
    routeSrc,
    /await logCronRun\("vector-full-state-snapshot"[\s\S]*await runVectorFullStateSnapshot/,
    "logCronRun must not await the heavy sweep inline"
  );
});

test("vector-full-state-snapshot acquires a cross-replica overlap lock before dispatching", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before dispatch, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
  // The skip branch must return before reaching the after()/dispatch() call, not alongside it.
  const skipIdx = routeSrc.indexOf('reason: "previous full-state snapshot still in flight');
  const dispatchIdx = routeSrc.indexOf("after(dispatchSnapshot)");
  assert.ok(skipIdx > 0 && dispatchIdx > 0 && skipIdx < dispatchIdx);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the cron shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,120}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future snapshot"
  );
});

test("the lock is released in a finally block so a thrown sweep still frees the next run", () => {
  const finallyBlock = /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
});

test("the lock TTL matches the cron's own stale_after_min safety net (15 min = 900s)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 900/);
});
