// Regression: bie-full-state-snapshot must not run overlapping snapshots across replicas.
//
// Measured live on prod 2026-09-21 (11:37-14:37 UTC RTH window): real runs logged
// elapsed=407874ms and elapsed=355974ms against a schedule of every 5 minutes during RTH
// (`cron(*/5 11-21 ? * MON-FRI *)`, confirmed via the deployed EventBridge rule) — with no
// overlap guard, the next scheduled fire lands while the previous run is still in flight, and
// both instances compete for the same tight cluster-wide Polygon/UW rate limiters that real
// member requests and every other Vector/0DTE cron already depend on. Same `sharedCacheSetNx`
// idempotent-skip pattern already used by vector-pick-sweep/zerodte-warm/swing-discovery/
// banger-discovery/thermal-discord for this exact problem shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("bie-full-state-snapshot acquires a cross-replica overlap lock before dispatching", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before dispatch, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of dispatching a second snapshot", () => {
  assert.match(routeSrc, /skipped: true,\s*\n\s*reason: "previous snapshot still in flight/);
  // The skip branch must return before reaching the after()/dispatch() call, not alongside it.
  const skipIdx = routeSrc.indexOf('reason: "previous snapshot still in flight');
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

test("the lock is released in a finally block so a thrown snapshot still frees the next run", () => {
  const finallyBlock = /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
});

test("the lock TTL matches the cron's own stale_after_min safety net (15 min = 900s)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 900/);
});

// REGRESSION 2026-09-21: measured real elapsed=407874ms on prod — the TTL must stay comfortably
// above the worst measured runtime, not just above the schedule interval, or the lock itself
// expires mid-run and lets a second snapshot start while the first is still in flight.
test("the lock TTL has real margin above the worst measured snapshot runtime (408s observed)", () => {
  const match = routeSrc.match(/OVERLAP_LOCK_TTL_SEC = (\d+)/);
  assert.ok(match, "OVERLAP_LOCK_TTL_SEC must be a bare numeric literal for this check to hold");
  const ttlSec = Number(match[1]);
  const worstObservedSec = 408; // ceil(407874ms)
  assert.ok(
    ttlSec > worstObservedSec,
    `TTL (${ttlSec}s) must exceed the worst measured runtime (${worstObservedSec}s) or the lock expires mid-run`
  );
});

test("the overlap lock key is distinct from every other cron's own lock key", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_KEY = "bie-full-state-snapshot:running"/);
});
