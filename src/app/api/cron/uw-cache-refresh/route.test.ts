import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression for the 2026-09-04 audit-sweep finding: this cron's 24-way UW/Polygon fan-out
// (5 sector tides + 3 index tickers x 3 fetches + 5 singles + 2 flow-per-strike) was the one
// remaining background sweep NOT tagged with runWithBackgroundUwSweep, unlike vector-dark-pool-
// warm/vector-pick-sweep/vector-full-state-snapshot/bie-full-state-snapshot (all fixed in PR
// #3479). Live CloudWatch showed 939 real "[uw] flow-alerts failed: rate-limiter queue budget
// exceeded" events in one 2.5h RTH window, clustering inside/at-the-start of this cron's own
// measured 20-66s run windows (vs 27 such failures in an equivalent off-hours window) — i.e. this
// cron was starving live member UW requests exactly the way the four already-fixed crons were.
test("uw-cache-refresh imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/,
    "must import the background-sweep tag from the shared rate limiter, not reimplement one"
  );
});

test("uw-cache-refresh's background dispatch is wrapped in runWithBackgroundUwSweep, not called bare", () => {
  const at = routeSrc.indexOf("const dispatchRefresh");
  assert.ok(at >= 0, "dispatchRefresh closure must exist");
  const block = routeSrc.slice(at, routeSrc.indexOf("};", at));
  assert.match(
    block,
    /runWithBackgroundUwSweep\(\(\) => runUwCacheRefreshTasks\(started, redis\)\)/,
    "the 24-way fan-out must run inside the background-sweep tag so it always leaves a UW " +
      "concurrency slot reachable for live member traffic"
  );
  assert.equal(
    /void runUwCacheRefreshTasks\(started, redis\)\.catch/.test(block),
    false,
    "the old untagged call must be gone, not left alongside the new one"
  );
});

test("uw-cache-refresh acquires a cross-replica overlap lock before dispatching REST fan-out", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before dispatch, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of dispatching a second refresh", () => {
  assert.match(
    routeSrc,
    /skipped: true,\s*\n\s*reason: "previous UW cache refresh still in flight/
  );
  const skipIdx = routeSrc.indexOf('reason: "previous UW cache refresh still in flight');
  const dispatchIdx = routeSrc.indexOf("after(dispatchRefresh)");
  assert.ok(skipIdx > 0 && dispatchIdx > 0 && skipIdx < dispatchIdx);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the cron shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,120}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future refresh"
  );
});

test("the lock is released in a finally block so a thrown refresh still frees the next run", () => {
  const finallyBlock =
    /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
});

test("the lock TTL matches the cron's own stale_after_min safety net (10 min = 600s)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 600/);
});
