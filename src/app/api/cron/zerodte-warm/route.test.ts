// Regression: zerodte-warm must not run overlapping scanner ticks / board-snapshot rebuilds
// across replicas / trigger sources.
//
// Measured live on prod 2026-09-02: two "[cron/zerodte-warm] background done" completions
// logged 2.171s apart (15:28:37.606 and 15:28:39.777 UTC) with elapsed=168371ms and
// elapsed=123934ms — their runtimes overlapped for 100+ seconds of concurrent execution. This
// route has two independent, uncoordinated trigger sources (EventBridge's own ~5min schedule
// AND the in-app rth-warm-leader, which re-dispatches this key the instant it's more than 4
// minutes stale) with no lock between them. Same `sharedCacheSetNx` idempotent-skip pattern
// already used by vector-pick-sweep and desk-warm for this exact problem shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("zerodte-warm acquires a cross-replica overlap lock before dispatching", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before dispatch, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of dispatching a second scan", () => {
  assert.match(routeSrc, /skipped: true,\s*\n\s*reason: "previous zerodte warm still in flight/);
  // The skip branch must return before reaching the dispatchWarm/after() call, not alongside it.
  const skipIdx = routeSrc.indexOf('reason: "previous zerodte warm still in flight');
  const dispatchIdx = routeSrc.indexOf("after(dispatchWarm)");
  assert.ok(skipIdx > 0 && dispatchIdx > 0 && skipIdx < dispatchIdx);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the cron shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,120}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future scan"
  );
});

test("the lock is released once the background dispatch settles, on both success and failure paths", () => {
  // Unlike desk-warm/vector-pick-sweep (async/await try/finally around one function), this
  // route's background work is a .then()/.catch() promise chain — so release happens in a
  // .finally() on that chain, not a try/finally block. Both must exist and .finally() must run
  // after the .catch(), so a rejection still frees the lock for the next run.
  assert.match(
    routeSrc,
    /\.finally\(\(\) => \{\s*void sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}\)/,
    "release must run in a .finally() on the dispatch promise chain, on both success and error paths"
  );
  const catchIdx = routeSrc.indexOf(".catch((err) => {");
  const finallyIdx = routeSrc.indexOf(".finally(() => {");
  assert.ok(catchIdx > 0 && finallyIdx > 0 && catchIdx < finallyIdx, ".finally() must chain after .catch()");
});

test("the lock TTL matches the cron's own stale_after_min safety net (15 min = 900s)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 900/);
});
