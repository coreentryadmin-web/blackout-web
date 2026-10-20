import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Cross-replica overlap guard (FINDINGS 2026-09-02 ALB tail-latency chain). platform-warm shares
// the same ~5min EventBridge schedule band as desk-warm, zerodte-warm, meridian-warm, and
// swing-active-refresh. Without a lock, concurrent invocations fan out the same UW-bound warm work
// on every web-tier replica, compounding into measured ALB p99 latency spikes (51s → 93.7s over
// 50min, traced to 67-100s platform-warm runs). Same `sharedCacheSetNx` deduplication pattern as
// meridian-warm guards this.
test("platform-warm has cross-replica OVERLAP_LOCK guard to prevent concurrent loadBootstrapBundle() on every replica", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\bsharedCacheSetNx\b[^}]*\} from "@\/lib\/shared-cache"/,
    "must import sharedCacheSetNx for overlap lock"
  );
  assert.match(
    routeSrc,
    /const OVERLAP_LOCK_KEY\s*=\s*"platform-warm:running"/,
    "must define OVERLAP_LOCK_KEY"
  );
  assert.match(
    routeSrc,
    /await sharedCacheSetNx\(\s*OVERLAP_LOCK_KEY,/,
    "must use sharedCacheSetNx to acquire the overlap lock before dispatching"
  );
  assert.match(
    routeSrc,
    /await sharedCacheDel\(OVERLAP_LOCK_KEY\)/,
    "must release the overlap lock in a finally block on completion"
  );
});

// REGRESSION 2026-10-20 (DISCOVERY-lane sweep): this file never asserted a specific
// OVERLAP_LOCK_TTL_SEC value at all, internal or cross-file. route.ts's own comment claimed
// lockstep with cron-registry.ts's stale_after_min ("TTL (600s) matches ... stale_after_min:
// 10") but the registry entry actually said 15 — a real drift traced to #5984 copy-pasting the
// comment/TTL from meridian-warm (whose own stale_after_min genuinely is 10) without adjusting
// for platform-warm's own registry value. Fixed by correcting the registry to 10 (matching this
// cron's true siblings in the same job family, desk-warm and meridian-warm, both 10) rather than
// inventing an unmeasured 900s TTL. This test is the check that would have caught the drift.
test("the overlap-lock TTL stays in lockstep with this cron's own stale_after_min in cron-registry.ts", async () => {
  const { CRON_JOBS } = await import("../../../../lib/cron-registry.ts");
  const entry = CRON_JOBS.find((j: { key: string }) => j.key === "platform-warm");
  assert.ok(entry, "cron-registry.ts must still carry a platform-warm entry");
  const match = routeSrc.match(/OVERLAP_LOCK_TTL_SEC\s*=\s*(\d+)/);
  assert.ok(match, "OVERLAP_LOCK_TTL_SEC must be a bare numeric literal for this check to hold");
  const ttlMinutes = Number(match[1]) / 60;
  assert.equal(
    ttlMinutes,
    (entry as { stale_after_min: number }).stale_after_min,
    `OVERLAP_LOCK_TTL_SEC (${Number(match[1])}s = ${ttlMinutes}min) must match cron-registry.ts's ` +
      `stale_after_min (${(entry as { stale_after_min: number }).stale_after_min}min) for this cron — ` +
      "a mismatch means the two drifted apart, per this route's own stated lockstep intent"
  );
});

test("platform-warm has RERUN_COOLDOWN floor to prevent force=1 replay spam", () => {
  assert.match(
    routeSrc,
    /const RERUN_COOLDOWN_KEY\s*=\s*"platform-warm:cooldown"/,
    "must define RERUN_COOLDOWN_KEY"
  );
  assert.match(
    routeSrc,
    /const RERUN_COOLDOWN_SEC\s*=\s*60/,
    "must define 60s cooldown for RTH window"
  );
  assert.match(
    routeSrc,
    /const OFF_WINDOW_FORCE_COOLDOWN_SEC\s*=\s*300/,
    "must define wider 300s cooldown outside warm hours"
  );
  assert.match(
    routeSrc,
    /await sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY,/,
    "must check RERUN_COOLDOWN via sharedCacheSetNx before dispatch"
  );
});

test("platform-warm gates run priority: auth → hours gate → cooldown → overlap lock → dispatch", () => {
  // Find locations of actual function calls/checks in GET handler, not imports
  const authAt = routeSrc.indexOf("if (!isCronAuthorized(req))");
  const hoursAt = routeSrc.indexOf("if (!shouldRunCacheWarmer");
  const cooldownAt = routeSrc.indexOf("const withinCooldown");
  const overlapAt = routeSrc.indexOf("const acquired =");
  const dispatchAt = routeSrc.indexOf("const dispatchWarm");

  assert.ok(
    authAt >= 0 && hoursAt >= 0 && cooldownAt >= 0 && overlapAt >= 0 && dispatchAt >= 0,
    "all guards must be present"
  );
  assert.ok(authAt < hoursAt, "auth must check before hours gate");
  assert.ok(hoursAt < cooldownAt, "hours gate must check before cooldown");
  assert.ok(cooldownAt < overlapAt, "cooldown must check before overlap lock");
  assert.ok(overlapAt < dispatchAt, "overlap lock must acquire before dispatch");
});
