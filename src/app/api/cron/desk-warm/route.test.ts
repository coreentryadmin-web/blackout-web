// Regression: desk-warm must not run overlapping warms across replicas / trigger sources.
//
// Measured live on prod 2026-09-02: FOUR "[cron/desk-warm] background done" completions logged
// within a 17.5s window (15:26:01.386-15:26:18.865 UTC), each carrying elapsed=9-24s — real
// concurrent execution, not a hypothetical. This route has two independent, uncoordinated
// trigger sources (EventBridge's own ~5min schedule AND the in-app rth-warm-leader, which
// re-dispatches this key the instant it's more than 90s stale — the tightest heal threshold of
// any watched key) with no lock between them. Same `sharedCacheSetNx` idempotent-skip pattern
// already used by vector-pick-sweep for this exact problem shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("desk-warm acquires a cross-replica overlap lock before dispatching", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before dispatch, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of dispatching a second warm", () => {
  assert.match(routeSrc, /skipped: true,\s*\n\s*reason: "previous desk warm still in flight/);
  // The skip branch must return before reaching the dispatchWarm/after() call, not alongside it.
  const skipIdx = routeSrc.indexOf('reason: "previous desk warm still in flight');
  const dispatchIdx = routeSrc.indexOf("after(dispatchWarm)");
  assert.ok(skipIdx > 0 && dispatchIdx > 0 && skipIdx < dispatchIdx);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the cron shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,120}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future warm"
  );
});

test("the lock is released in a finally block so a thrown warm still frees the next run", () => {
  const finallyBlock = /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
});

test("the lock TTL matches the cron's own stale_after_min safety net (10 min = 600s)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 600/);
});
