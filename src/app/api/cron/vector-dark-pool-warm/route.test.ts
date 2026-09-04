// Regression: vector-dark-pool-warm must not fan its ~55-ticker universe out unbounded against
// the shared UW rate limiter.
//
// Measured live on prod 2026-09-02: the route fired every universe ticker's warmVectorDarkPool()
// call via Promise.allSettled at once. Each call immediately entered the UW rate limiter's
// admission queue (GLOBAL_MAX_RPS=2, DEFAULT_QUEUE_MAX_WAIT_MS=20s in queue-budget.ts) — with ~55
// simultaneous entrants, tickers near the back of the queue routinely waited past the 20s budget
// and were dropped, producing 83-95% per-run ticker failures. runUwPool (same pattern already
// used by nighthawk's fetchIndexFlowsPooled) bounds how many calls are in flight at once, keeping
// each ticker's queue wait well under the timeout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("vector-dark-pool-warm bounds its universe fan-out through the shared UW pool helper", () => {
  assert.match(routeSrc, /runUwPool/, "must route the per-ticker fetches through the bounded-concurrency pool");
  assert.match(
    routeSrc,
    /import \{[^}]*\brunUwPool\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/,
    "must import the pool helper from the shared rate limiter, not reimplement one"
  );
});

test("the route no longer fires the universe fan-out unbounded via Promise.allSettled", () => {
  assert.doesNotMatch(
    routeSrc,
    /Promise\.allSettled\(\s*tickers\.map\(\s*\(t\)\s*=>\s*warmVectorDarkPool\(t\)\s*\)\s*\)/,
    "the unbounded fan-out this finding fixed must not come back"
  );
});

test("each pooled task catches its own rejection so one ticker's throw cannot abort the whole pool", () => {
  // runUwPool uses Promise.all internally across its worker loop, so an uncaught rejection from
  // one task would cancel every other in-flight ticker's warm. Each task must therefore settle
  // itself into a PromiseSettledResult shape before returning to the pool.
  assert.match(routeSrc, /status: "fulfilled", value: await warmVectorDarkPool\(t\)/);
  assert.match(routeSrc, /catch \(reason\) \{\s*return \{ status: "rejected", reason \};/);
});

test("the downstream fulfilled/fetchFailed aggregation is unchanged by the pooling fix", () => {
  // The bug and the fix are both about HOW the calls are scheduled, not how results are counted —
  // this pins the existing per-ticker accounting so the fix can't accidentally regress it.
  assert.match(routeSrc, /if \(r\.status === "fulfilled"\)/);
  assert.match(routeSrc, /if \(r\.value\.fetchFailed\)/);
});

test("force=1 is rate-limited by a minimum re-run cooldown, independent of the cash-RTH gate", () => {
  assert.match(
    routeSrc,
    /RERUN_COOLDOWN_SEC = 60/,
    "UW-heavy warmers use a 60s floor — well below the ~10 min EventBridge schedule"
  );
  assert.match(
    routeSrc,
    /RERUN_COOLDOWN_KEY = "vector-dark-pool-warm:cooldown"/,
    "cooldown key must be cron-specific"
  );
  assert.match(
    routeSrc,
    /const withinCooldown = !\(await sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY,/,
    "the cooldown claim must be atomic"
  );

  const cooldownIdx = routeSrc.indexOf("RERUN_COOLDOWN_KEY,");
  const dispatchIdx = routeSrc.indexOf("after(dispatchWarm)");
  assert.ok(cooldownIdx > 0 && dispatchIdx > 0);
  assert.ok(cooldownIdx < dispatchIdx, "cooldown must be checked before dispatch");

  const skipIdx = routeSrc.indexOf("reason: `rate-limited");
  assert.ok(skipIdx > cooldownIdx && skipIdx < dispatchIdx);

  assert.match(
    routeSrc,
    /sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY[\s\S]{0,80}\)\.catch\(\(\) => true\)/,
    "a Redis error on the cooldown claim must fail OPEN"
  );

  assert.doesNotMatch(
    routeSrc,
    /sharedCacheDel\(RERUN_COOLDOWN_KEY\)/,
    "cooldown must expire on TTL, not be released early"
  );
});

test("the cooldown primitive genuinely refuses a second claim of the same key inside its TTL", async () => {
  const { sharedCacheSetNx, sharedCacheDel } = await import("@/lib/shared-cache");
  const key = `vector-dark-pool-warm:cooldown:test:${Date.now()}:${Math.random()}`;
  try {
    const first = await sharedCacheSetNx(key, { startedAt: Date.now() }, 10);
    assert.equal(first, true, "first claim must succeed");
    const second = await sharedCacheSetNx(key, { startedAt: Date.now() }, 10);
    assert.equal(second, false, "second claim inside TTL must be refused");
  } finally {
    await sharedCacheDel(key).catch(() => undefined);
  }
});
