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
  // The skip branch must return before reaching the dispatchWarm call, not alongside it.
  const skipIdx = routeSrc.indexOf('reason: "previous zerodte warm still in flight');
  const dispatchIdx = routeSrc.indexOf("void dispatchWarm();");
  assert.ok(skipIdx > 0 && dispatchIdx > 0 && skipIdx < dispatchIdx);
});

// Regression (2026-09-08 live incident): `after()` was the ORIGINAL dispatch mechanism for the
// background scan+persist work — and it silently, repeatedly failed to run to completion for
// 3+ hours of live RTH, spanning a full production redeploy. `zerodte_scan_rejections` (this
// work's own persisted output) took its last write at 14:23:33 UTC and never wrote again; only
// 2 of ~36 recorded "ok" route responses that day had a matching `[cron/zerodte-warm] background
// done` completion log. This ECS Fargate deployment is a long-lived standalone Next.js server —
// `after()`'s reason to exist (keep a request's context alive past the response on a platform
// that would otherwise tear it down) does not apply, so the fix drops the dependency entirely:
// dispatch is now an unconditional, bare fire-and-forget call, not routed through `after()`.
test("the background scan+persist dispatch does not depend on after() to run", () => {
  assert.doesNotMatch(
    routeSrc,
    /import \{[^}]*\bafter\b[^}]*\} from "next\/server"/,
    "after() must not be imported — it was the mechanism that silently failed to complete for 3+ hours live"
  );
  assert.doesNotMatch(routeSrc, /after\(dispatchWarm\)/, "dispatch must not be routed through after()");
  assert.match(
    routeSrc,
    /\n  void dispatchWarm\(\);\n/,
    "dispatch must be an unconditional, bare fire-and-forget call — always executed, never deferred"
  );
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

// Regression for the 2026-09-04 finding: this test used to assert the OPPOSITE — that
// zerodte-warm intentionally omitted the UW sweep tag because its work was "platform-local,
// not a UW REST fan-out". That premise was wrong: warmZeroDteBoard -> scanZeroDteBoard and
// refreshZeroDteBoardSnapshot -> buildZeroDteBoardPayload -> scanZeroDteBoard both hit
// fetchTickerDossier (runUwPooled from uw-rate-limiter) for the top-ranked setups' dossier
// enrichment, so this cron's tick was racing live member requests for the same UW ceiling
// with none of the "reserve one slot for live traffic" protection the four Vector-family
// crons already carry (vector-full-state-snapshot, vector-dark-pool-warm,
// bie-full-state-snapshot, vector-pick-sweep). Live evidence: PR #3759's queue-wait
// instrumentation showed a 30s window of near-continuous UNTAGGED 10-19s admissions
// correlating with [zerodte-scan] log lines on the same ECS task.
test("zerodte-warm wraps its board-scan dispatch in the shared background UW sweep helper", () => {
  assert.match(
    routeSrc,
    /runWithBackgroundUwSweep\(\(\) =>\s*\n\s*Promise\.allSettled\(\[warmZeroDteBoard\(\), refreshZeroDteBoardSnapshot\(\)\]\)/,
    "the cron's OWN dispatch must be tagged so it reserves a slot for live traffic, matching the four existing Vector-family crons"
  );
  // The wrap must be around the CRON's dispatch only — the shared read path
  // (getZeroDteBoardPayload, used by /api/market/zerodte/board and
  // /api/market/nighthawk/horizons) must stay untagged, since those callers ARE live traffic.
  assert.doesNotMatch(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "market", "zerodte", "board", "route.ts"),
      "utf8"
    ),
    /runWithBackgroundUwSweep/,
    "the live board-read route must never be tagged as a background sweep"
  );
});

test("force=1 is rate-limited by a minimum re-run cooldown, independent of the hours gate", () => {
  assert.match(routeSrc, /RERUN_COOLDOWN_SEC = 60/, "the floor must exist and be tuned below rth-warm-leader's 4 min heal threshold");
  assert.match(routeSrc, /RERUN_COOLDOWN_KEY = "zerodte-warm:cooldown"/, "must be a key distinct from OVERLAP_LOCK_KEY");

  assert.match(
    routeSrc,
    /const withinCooldown = !\(await sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY,/,
    "the cooldown claim must be atomic, not a separate read-then-write"
  );

  const cooldownIdx = routeSrc.indexOf("RERUN_COOLDOWN_KEY,");
  const overlapClaimIdx = routeSrc.indexOf("const acquired = await sharedCacheSetNx(");
  const dispatchIdx = routeSrc.indexOf("void dispatchWarm();");
  assert.ok(cooldownIdx > 0 && overlapClaimIdx > 0 && dispatchIdx > 0);
  assert.ok(cooldownIdx < overlapClaimIdx, "cooldown must be checked before the overlap lock");
  assert.ok(overlapClaimIdx < dispatchIdx, "overlap lock must still be checked before dispatch");

  const skipIdx = routeSrc.indexOf("reason: `rate-limited");
  assert.ok(skipIdx > cooldownIdx && skipIdx < dispatchIdx);

  assert.match(
    routeSrc,
    /sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY[\s\S]{0,80}\)\.catch\(\(\) => true\)/,
    "a Redis error on the cooldown claim must not permanently block every future warm"
  );

  // Narrowed 2026-09-18 (issue #5213): the cooldown now CAN be released early, but only from
  // inside the STEAL_ATTEMPT_KEY-guarded wedged-lock breaker below — never from the routine
  // cooldown-check path itself. Assert the del call exists only within that guarded block.
  const dels = [...routeSrc.matchAll(/sharedCacheDel\(RERUN_COOLDOWN_KEY\)/g)];
  assert.equal(dels.length, 1, "exactly one early-release site — the wedged-lock steal, not a routine path");
  const delIdx = dels[0].index!;
  const wonStealIdx = routeSrc.indexOf("if (wonSteal) {");
  assert.ok(
    wonStealIdx > 0 && delIdx > wonStealIdx && delIdx < wonStealIdx + 300,
    "the cooldown may only be released early from inside the guarded steal block"
  );
});

test("a force=1 call OUTSIDE the extended warm window is throttled at a much wider floor than one made inside it", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth, isEtExtendedWarmHours \} from "@\/lib\/et-market-hours"/,
    "must check the SAME holiday-aware window the in-app dispatchers already gate on"
  );
  assert.match(
    routeSrc,
    /OFF_WINDOW_FORCE_COOLDOWN_SEC = 300/,
    "the off-window floor must be materially wider than the in-window 60s floor"
  );
  assert.match(
    routeSrc,
    /const effectiveCooldownSec = isEtExtendedWarmHours\(\)\s*\n\s*\? RERUN_COOLDOWN_SEC\s*\n\s*: OFF_WINDOW_FORCE_COOLDOWN_SEC;/,
    "the floor actually used must depend on the window, not just exist as an unused constant"
  );
  assert.match(
    routeSrc,
    /const withinCooldown = !\(await sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY,\s*\{ startedAt: started \},\s*effectiveCooldownSec\s*\)/,
    "the cooldown claim must use effectiveCooldownSec, not the flat RERUN_COOLDOWN_SEC"
  );
});

// Regression (2026-09-18 live P0, issue #5213): the cooldown/overlap-lock pair has no
// visibility into whether the background work they protect ever actually completes. If
// dispatchWarm()'s ~4-5min background chain dies mid-flight (e.g. its hosting ECS task is
// recycled for a deploy before OVERLAP_LOCK_KEY's .finally() release runs), every subsequent
// attempt is silently blocked for up to the lock's 900s TTL regardless of how stale the scan
// heartbeat gets. Measured live: zerodte_scan_heartbeat stuck 50+ minutes while cron_job_runs
// kept logging ok/skipped every cycle.
test("a critical_stale scan heartbeat during cash RTH steals and clears both wedged locks before the normal claim", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth, isEtExtendedWarmHours \} from "@\/lib\/et-market-hours"/,
    "must gate on cash RTH specifically — off-hours staleness is expected and already suppressed elsewhere"
  );
  assert.match(
    routeSrc,
    /import \{ loadZeroDteScanHeartbeat \} from "@\/lib\/play-engine-heartbeat"/
  );
  assert.match(routeSrc, /if \(isEtCashRth\(\)\) \{/);
  assert.match(routeSrc, /heartbeat\?\.critical_stale/);

  // The steal attempt must itself be NX-atomic (STEAL_ATTEMPT_KEY) so exactly one concurrent
  // invocation performs the clear, even if many replicas observe critical_stale at once.
  assert.match(routeSrc, /STEAL_ATTEMPT_KEY = "zerodte-warm:steal-attempt"/);
  assert.match(
    routeSrc,
    /const wonSteal = await sharedCacheSetNx\(\s*STEAL_ATTEMPT_KEY,/,
    "the steal attempt itself must be an atomic NX claim, not a read-then-write race"
  );

  // Only the winner clears both keys — RERUN_COOLDOWN_KEY and OVERLAP_LOCK_KEY.
  const wonStealIdx = routeSrc.indexOf("if (wonSteal) {");
  const clearBlock = routeSrc.slice(wonStealIdx, wonStealIdx + 300);
  assert.match(clearBlock, /sharedCacheDel\(RERUN_COOLDOWN_KEY\)/);
  assert.match(clearBlock, /sharedCacheDel\(OVERLAP_LOCK_KEY\)/);

  // The steal-and-clear must happen BEFORE the normal cooldown claim, not after — otherwise a
  // wedged cooldown would already have rejected the run before the steal ever ran.
  const stealBlockIdx = routeSrc.indexOf("if (isEtCashRth()) {");
  const cooldownClaimIdx = routeSrc.indexOf("const withinCooldown = !(await sharedCacheSetNx(");
  assert.ok(stealBlockIdx > 0 && cooldownClaimIdx > 0 && stealBlockIdx < cooldownClaimIdx);
});

test("the cooldown primitive genuinely refuses a second claim of the same key inside its TTL", async () => {
  const { sharedCacheSetNx, sharedCacheDel } = await import("@/lib/shared-cache");
  const key = `zerodte-warm:cooldown:test:${Date.now()}:${Math.random()}`;
  try {
    const first = await sharedCacheSetNx(key, { startedAt: Date.now() }, 60);
    const secondImmediately = await sharedCacheSetNx(key, { startedAt: Date.now() }, 60);
    assert.equal(first, true, "the first call must be allowed to run");
    assert.equal(secondImmediately, false, "a second replay inside the cooldown window must be refused");
  } finally {
    await sharedCacheDel(key);
  }
});
