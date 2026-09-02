// Regression: vector-pick-sweep must not run overlapping sweeps across replicas.
//
// Measured live on prod 2026-09-01: a single sweep logged elapsed=301362ms (5m1s) against a
// schedule of every 2 minutes during RTH — with no overlap guard, the next scheduled fire lands
// while the previous run is still in flight, and both instances compete for the same tight
// cluster-wide Polygon/UW rate limiters that real member requests depend on (measured ALB
// TargetResponseTime p99 40-111s in the same window). Same `sharedCacheSetNx` idempotent-skip
// pattern already used by swing-discovery/banger-discovery/thermal-discord.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("vector-pick-sweep acquires a cross-replica overlap lock before dispatching", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before dispatch, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of dispatching a second sweep", () => {
  assert.match(routeSrc, /skipped: true,\s*\n\s*reason: "previous sweep still in flight/);
  // The skip branch must return before reaching the after()/dispatch() call, not alongside it.
  const skipIdx = routeSrc.indexOf('reason: "previous sweep still in flight');
  const dispatchIdx = routeSrc.indexOf("after(dispatch)");
  assert.ok(skipIdx > 0 && dispatchIdx > 0 && skipIdx < dispatchIdx);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the cron shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,120}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future sweep"
  );
});

test("the lock is released in a finally block so a thrown sweep still frees the next run", () => {
  const finallyBlock = /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
});

test("the lock TTL matches the cron's own stale_after_min safety net (8 min = 480s)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 480/);
});
