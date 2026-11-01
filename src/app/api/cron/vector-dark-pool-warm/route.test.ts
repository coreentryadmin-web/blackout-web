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

// Regression (2026-10-13/14): this cron's own self-overlap lock only ever stopped IT from
// overlapping with itself. Live CloudWatch (2026-10-13 13:35-13:56 UTC) showed this cron and 5
// OTHER heavy crons in flight at once on the shared web tier, 1:1 correlated with sustained ALB
// tail latency — see heavy-cron-concurrency-guard.ts's header for the full evidence.
test("a cross-cron concurrency slot is acquired after the self-overlap lock, before dispatch", () => {
  assert.match(
    routeSrc,
    /import \{ acquireHeavyCronSlot, type HeavyCronSlot \} from "@\/lib\/cron\/heavy-cron-concurrency-guard"/,
    "must import the shared cross-cron concurrency guard"
  );
  assert.match(
    routeSrc,
    /const slot = await acquireHeavyCronSlot\("vector-dark-pool-warm", 610\);/,
    "must acquire a named heavy-cron slot with the same TTL as the self-overlap lock"
  );
  const overlapClaimIdx = routeSrc.indexOf('"cron:vector-dark-pool-warm:lock"');
  const slotIdx = routeSrc.indexOf("const slot = await acquireHeavyCronSlot(");
  const dispatchIdx = routeSrc.indexOf("const dispatchWarm = () => {");
  assert.ok(
    overlapClaimIdx > 0 && slotIdx > overlapClaimIdx && slotIdx < dispatchIdx,
    "the cross-cron slot must be acquired AFTER the self-overlap lock and BEFORE dispatch is defined"
  );
});

test("a lost cross-cron concurrency race skips the run instead of dispatching a second heavy warm", () => {
  assert.match(
    routeSrc,
    /if \(!slot\) \{[\s\S]*?const payload = \{ ok: true, skipped: true, reason: "heavy-cron concurrency slot unavailable \(idempotent skip\)" \};/,
    "a lost race must skip honestly, not silently proceed without a slot"
  );
});

test("the heavy-cron slot is released alongside the background warm, in the inner function's finally block", () => {
  assert.match(
    routeSrc,
    /async function runVectorDarkPoolWarm\(started: number, slot: HeavyCronSlot\): Promise<void> \{\s*try \{\s*await runVectorDarkPoolWarmInner\(started\);\s*\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*await slot\.release\(\);\s*\}\s*\}/,
    "release must run on both the success and error paths, wrapping the real work rather than inlined into it"
  );
});

// Regression (2026-10-26): a lost cross-cron concurrency race left the self-overlap lock
// (`cron:vector-dark-pool-warm:lock`, 610s TTL) standing for its full lifetime even though no
// work ever ran. The schedule is every 10 minutes (600s), so the NEXT scheduled fire landed
// before that lock expired and was ALSO skipped — as "prior run still executing", even though
// nothing was actually running. vector-pick-sweep (the sibling file using the exact same
// self-overlap-lock + heavy-cron-slot pattern) already fixed this shape in #5975 by releasing
// its own overlap lock immediately on a lost race, with the explicit comment "so the NEXT
// scheduled fire (not this one) gets a clean shot" — this route never got the matching fix.
test("a lost cross-cron concurrency race releases the self-overlap lock before skipping", () => {
  assert.match(
    routeSrc,
    /import \{ sharedCacheDel, sharedCacheGet, sharedCacheSet, sharedCacheSetNx \} from "@\/lib\/shared-cache"/,
    "must import sharedCacheDel to release the self-overlap lock on a lost race"
  );
  const slotCheckIdx = routeSrc.indexOf("if (!slot) {");
  const dispatchDefIdx = routeSrc.indexOf("const dispatchWarm = () => {");
  // Search FROM slotCheckIdx, not from the start of the file — the finally-block release inside
  // runVectorDarkPoolWarm (added for the round-224 fix below) now also matches this literal and
  // is defined earlier in the file, so a bare indexOf() would find THAT one instead of the
  // lost-race branch's own release and pass even if the lost-race release were ever removed.
  const releaseInLostRaceIdx = routeSrc.indexOf(
    "await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined);",
    slotCheckIdx
  );
  assert.ok(
    slotCheckIdx > 0 &&
      releaseInLostRaceIdx > slotCheckIdx &&
      releaseInLostRaceIdx < dispatchDefIdx,
    "a lost heavy-cron-slot race must release the self-overlap lock inside the `if (!slot)` branch, " +
      "before the lock's 610s TTL would otherwise block the next scheduled fire too"
  );
});

// Regression (2026-11-01, round 224). Unlike this exact pattern's sibling warm-crons
// (vector-pick-sweep, vector-walls-warm, vector-full-state-snapshot — each releases its overlap
// lock in a `finally` around the real background work), this route only ever released the lock on
// the lost-race early return above, never on the real work's success/failure path. Because the
// lock's TTL (610s) is picked to just barely outlast the ~10-minute (600s) schedule, a normal run
// that completes in well under 610s left the lock standing until it merely expired — still valid
// at the NEXT scheduled fire, which read "Prior run still executing" and skipped even though the
// prior run had long since finished. That silently halved this cron's effective cadence (~every
// 20 minutes instead of ~every 10), undermining the 2-way rotation's own 25-minute-cache-TTL
// coverage assumption (rotation.ts header). Fixed by releasing OVERLAP_LOCK_KEY in the same
// `finally` that already releases the cross-cron `slot`.
test("the self-overlap lock is defined as a shared constant used by every acquire/release site", () => {
  assert.match(
    routeSrc,
    /const OVERLAP_LOCK_KEY = "cron:vector-dark-pool-warm:lock";/,
    "the lock key must be a single shared constant, not re-typed as a literal at each call site"
  );
  const constDefIdx = routeSrc.indexOf('const OVERLAP_LOCK_KEY = "cron:vector-dark-pool-warm:lock";');
  const acquireIdx = routeSrc.indexOf("const acquired = await sharedCacheSetNx(\n    OVERLAP_LOCK_KEY,");
  const lostRaceReleaseIdx = routeSrc.indexOf(
    "await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined);"
  );
  const finallyReleaseIdx = routeSrc.lastIndexOf(
    "await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined);"
  );
  assert.ok(
    constDefIdx > 0 && acquireIdx > constDefIdx && lostRaceReleaseIdx > constDefIdx,
    "the constant must be defined once and reused by the acquire call and the lost-race release"
  );
  assert.notEqual(
    lostRaceReleaseIdx,
    finallyReleaseIdx,
    "there must be TWO distinct sharedCacheDel(OVERLAP_LOCK_KEY) release sites — the lost-race " +
      "early return AND the real background work's finally — not just one"
  );
});

test("the real background work releases the self-overlap lock on BOTH its success and failure path, not only on a lost cross-cron race", () => {
  const innerFnIdx = routeSrc.indexOf(
    "async function runVectorDarkPoolWarm(started: number, slot: HeavyCronSlot): Promise<void> {"
  );
  const innerFnEndIdx = routeSrc.indexOf(
    "async function runVectorDarkPoolWarmInner(started: number): Promise<void> {"
  );
  const releaseInFinallyIdx = routeSrc.indexOf(
    "await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined);",
    innerFnIdx
  );
  assert.ok(
    innerFnIdx > 0 &&
      innerFnEndIdx > innerFnIdx &&
      releaseInFinallyIdx > innerFnIdx &&
      releaseInFinallyIdx < innerFnEndIdx,
    "runVectorDarkPoolWarm (the function that wraps the REAL background work, not just the lost-race " +
      "early return) must itself release OVERLAP_LOCK_KEY — on a RED run of this test (pre-fix source), " +
      "the only release site is the lost-race branch, which sits entirely BEFORE runVectorDarkPoolWarm " +
      "is even defined, so releaseInFinallyIdx would be -1 (not found after innerFnIdx)"
  );
});
