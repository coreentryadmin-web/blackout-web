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

// Regression (2026-10-07): the concurrency bound above caps this cron's OWN admission-queue
// entrants, but a fresh re-measurement (post PR #5579's GLOBAL_MAX_RPS 2->4 raise) showed the
// full ~55-69-ticker universe still fails 90%+ of tickers per run — the shared queue is
// saturated by AGGREGATE cluster-wide UW demand, not just this cron's concurrency. The route
// must rotate through a HALF-sized batch per run (selectDarkPoolWarmBatch/halfBatchSize in
// ./rotation.ts) rather than asking the shared queue to admit the whole universe every time.
test("the route rotates a half-universe batch through the shared rotation helper, not the full universe", () => {
  assert.match(
    routeSrc,
    /import \{ halfBatchSize, selectDarkPoolWarmBatch \} from "\.\/rotation"/,
    "must reuse the shared rotation helper, not reimplement batch selection inline"
  );
  assert.match(
    routeSrc,
    /selectDarkPoolWarmBatch\(\s*allTickers,\s*cursor,\s*halfBatchSize\(allTickers\.length\)\s*\)/,
    "must select a HALF-sized rotating batch, not the full universe, per run"
  );
  assert.doesNotMatch(
    routeSrc,
    /runUwPool\(\s*allTickers\.map/,
    "must pool over the rotated batch, not the raw full-universe ticker list"
  );
});

test("the rotation cursor is persisted across runs via the shared cache, not per-process memory", () => {
  assert.match(
    routeSrc,
    /sharedCacheGet<number>\(ROTATION_CURSOR_KEY\)/,
    "must read the cursor back from shared (Redis-backed) cache so rotation survives across ECS tasks/runs"
  );
  assert.match(
    routeSrc,
    /sharedCacheSet\(ROTATION_CURSOR_KEY, nextCursor, ROTATION_CURSOR_TTL_SEC\)/,
    "must persist the next cursor so the following run continues coverage instead of restarting at 0"
  );
});
