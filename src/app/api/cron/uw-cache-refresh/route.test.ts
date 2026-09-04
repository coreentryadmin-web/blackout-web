// Regression: uw-cache-refresh must not run overlapping REST fan-outs across replicas.
// Same `sharedCacheSetNx` idempotent-skip pattern as desk-warm/meridian-warm.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("uw-cache-refresh acquires a cross-replica overlap lock before dispatching REST warm", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before dispatch, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of dispatching a second refresh", () => {
  assert.match(routeSrc, /reason: "previous UW cache refresh still in flight/);
  const skipIdx = routeSrc.indexOf('reason: "previous UW cache refresh still in flight');
  const dispatchIdx = routeSrc.indexOf("after(dispatchRefresh)");
  assert.ok(skipIdx > 0 && dispatchIdx > 0 && skipIdx < dispatchIdx);
});

test("sync WS seed and pulse snapshot still run before the overlap lock check", () => {
  const pulseIdx = routeSrc.indexOf("seedPulseSnapshotFromUwPrices");
  const lockIdx = routeSrc.indexOf("const acquired = await sharedCacheSetNx");
  assert.ok(pulseIdx > 0 && lockIdx > 0 && pulseIdx < lockIdx);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the cron shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,120}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future refresh"
  );
});

test("the lock is released in a finally block so a thrown refresh still frees the next run", () => {
  const finallyBlock = /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
});

test("the lock TTL matches the cron's own stale_after_min safety net (10 min = 600s)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 600/);
});
