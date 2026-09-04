// Regression: swing-active-refresh must handshake via after() so Cloudflare never 504s
// the cron before logCronRun fires (ops #1364 — same class as vector-universe-snapshot).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("swing-active-refresh dispatches refresh in after() and returns 202", () => {
  assert.match(routeSrc, /after\(dispatchRefresh\)/, "must use after() for fire-and-forget handshake");
  assert.match(routeSrc, /status:\s*202/, "must return HTTP 202 accepted");
  assert.match(routeSrc, /logCronRun\("swing-active-refresh"/, "must log cron handshake before response");
  assert.doesNotMatch(
    routeSrc,
    /await logCronRun\("swing-active-refresh"[\s\S]*await runSwingActiveRefresh\(/,
    "logCronRun must not await the heavy refresh inline"
  );
});

test("swing-active-refresh acquires a cross-replica overlap lock before dispatching", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(routeSrc, /const acquired = await sharedCacheSetNx\(/);
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of dispatching a second refresh", () => {
  assert.match(
    routeSrc,
    /skipped: true,\s*\n\s*reason: "previous swing active-refresh still in flight/
  );
  const skipIdx = routeSrc.indexOf('reason: "previous swing active-refresh still in flight');
  const dispatchIdx = routeSrc.indexOf("after(dispatchRefresh)");
  assert.ok(skipIdx > 0 && dispatchIdx > 0 && skipIdx < dispatchIdx);
});

test("swing-active-refresh is rate-limited by a minimum re-run cooldown", () => {
  assert.match(routeSrc, /RERUN_COOLDOWN_SEC = 60/);
  assert.match(routeSrc, /RERUN_COOLDOWN_KEY = "swing-active-refresh:cooldown"/);

  const cooldownIdx = routeSrc.indexOf("RERUN_COOLDOWN_KEY,");
  const overlapClaimIdx = routeSrc.indexOf("const acquired = await sharedCacheSetNx(");
  const dispatchIdx = routeSrc.indexOf("after(dispatchRefresh)");
  assert.ok(cooldownIdx > 0 && overlapClaimIdx > 0 && dispatchIdx > 0);
  assert.ok(cooldownIdx < overlapClaimIdx, "cooldown must be checked before the overlap lock");
  assert.ok(overlapClaimIdx < dispatchIdx, "overlap lock must still be checked before dispatch");

  assert.doesNotMatch(routeSrc, /sharedCacheDel\(RERUN_COOLDOWN_KEY\)/);
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

test("the lock TTL matches the cron stale_after_min safety net (25 min schedule band → 600s ceiling)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 600/);
});
