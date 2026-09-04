// Regression: meridian-warm must not run overlapping warms across replicas.
// Same `sharedCacheSetNx` idempotent-skip pattern as desk-warm/zerodte-warm.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("meridian-warm acquires a cross-replica overlap lock before dispatching", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before dispatch, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of dispatching a second warm", () => {
  assert.match(routeSrc, /skipped: true,\s*\n\s*reason: "previous Meridian warm still in flight/);
  const skipIdx = routeSrc.indexOf('reason: "previous Meridian warm still in flight');
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

test("force=1 is rate-limited by a minimum re-run cooldown, independent of the hours gate", () => {
  assert.match(routeSrc, /RERUN_COOLDOWN_SEC = 120/, "the floor must exist and sit below the 5 min heal threshold");
  assert.match(routeSrc, /RERUN_COOLDOWN_KEY = "meridian-warm:cooldown"/, "must be a key distinct from OVERLAP_LOCK_KEY");

  assert.match(
    routeSrc,
    /const withinCooldown = !\(await sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY,/,
    "the cooldown claim must be atomic, not a separate read-then-write"
  );

  const cooldownIdx = routeSrc.indexOf("RERUN_COOLDOWN_KEY,");
  const overlapClaimIdx = routeSrc.indexOf("const acquired = await sharedCacheSetNx(");
  const dispatchIdx = routeSrc.indexOf("after(dispatchWarm)");
  assert.ok(cooldownIdx > 0 && overlapClaimIdx > 0 && dispatchIdx > 0);
  assert.ok(cooldownIdx < overlapClaimIdx, "cooldown must be checked before the overlap lock");
  assert.ok(overlapClaimIdx < dispatchIdx, "overlap lock must still be checked before dispatch");

  const skipIdx = routeSrc.indexOf("reason: `rate-limited");
  assert.ok(skipIdx > cooldownIdx && skipIdx < dispatchIdx);

  assert.match(
    routeSrc,
    /sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY[\s\S]{0,80}\)\.catch\(\(\) => true\)/,
    "a Redis error on the cooldown claim must not permanently block every future warm pass"
  );

  assert.doesNotMatch(
    routeSrc,
    /sharedCacheDel\(RERUN_COOLDOWN_KEY\)/,
    "the cooldown must expire on its own TTL, not be released early like the overlap lock"
  );
});

test("the cooldown primitive genuinely refuses a second claim of the same key inside its TTL", async () => {
  const { sharedCacheSetNx, sharedCacheDel } = await import("@/lib/shared-cache");
  const key = `meridian-warm:cooldown:test:${Date.now()}:${Math.random()}`;
  try {
    const first = await sharedCacheSetNx(key, { startedAt: Date.now() }, 120);
    const secondImmediately = await sharedCacheSetNx(key, { startedAt: Date.now() }, 120);
    assert.equal(first, true, "the first call must be allowed to run");
    assert.equal(
      secondImmediately,
      false,
      "a second force=1 replay inside the cooldown window must be refused"
    );
  } finally {
    await sharedCacheDel(key);
  }
});
