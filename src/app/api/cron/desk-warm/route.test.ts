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

test("desk-warm background dispatch is wrapped in runWithBackgroundUwSweep", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
  );
  assert.match(routeSrc, /runWithBackgroundUwSweep\(\(\) => runDeskWarm\(started\)\)/);
});

// Regression: force=1 must not be an UNTHROTTLED bypass of the hours gate.
//
// Measured live 2026-09-04: 314 "[cron/desk-warm] background done" completions between 00:29 and
// 07:59 UTC — deep overnight, outside the 4am-8pm ET extended-warm window — median 40s apart, some
// under 15s. EventBridge (rule scoped 11-21 UTC, its Lambda logged ZERO desk-warm invocations in
// the window), rth-warm-leader (silent — zero "[rth-warm-leader]" log lines of any kind — until the
// exact 08:00:02 UTC ET-4am boundary), and cron-staleness-watchdog's self-heal (zero self-heal log
// lines all night; market_hours_stale cannot be true outside cash RTH by construction) were all
// positively ruled out with direct CloudWatch evidence, meaning some caller was hitting
// `?force=1` directly and nothing in the route capped how often it could. #3512's removal of the
// CACHE_WARM_ALWAYS bypass (the NORMAL/non-forced path) is unaffected by and unrelated to this fix.
test("force=1 is rate-limited by a minimum re-run cooldown, independent of the hours gate", () => {
  assert.match(routeSrc, /RERUN_COOLDOWN_SEC = 60/, "the floor must exist and be tuned below rth-warm-leader's 90s heal threshold");
  assert.match(routeSrc, /RERUN_COOLDOWN_KEY = "desk-warm:cooldown"/, "must be a key distinct from OVERLAP_LOCK_KEY");

  // Must be claimed via the same atomic NX primitive as the overlap lock (no read-then-write race).
  assert.match(
    routeSrc,
    /const withinCooldown = !\(await sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY,/,
    "the cooldown claim must be atomic, not a separate read-then-write"
  );

  // Ordering: cooldown is checked BEFORE the overlap lock and BEFORE any dispatch, so a rate-limited
  // caller never even reaches the overlap-lock claim or the background fan-out.
  const cooldownIdx = routeSrc.indexOf("RERUN_COOLDOWN_KEY,");
  const overlapClaimIdx = routeSrc.indexOf("const acquired = await sharedCacheSetNx(");
  const dispatchIdx = routeSrc.indexOf("after(dispatchWarm)");
  assert.ok(cooldownIdx > 0 && overlapClaimIdx > 0 && dispatchIdx > 0);
  assert.ok(cooldownIdx < overlapClaimIdx, "cooldown must be checked before the overlap lock");
  assert.ok(overlapClaimIdx < dispatchIdx, "overlap lock must still be checked before dispatch");

  // The rate-limited skip must actually return, not just log — same "return before dispatch" shape
  // as the existing overlap-lock skip test above. (Match the literal skip-payload reason, not the
  // word "rate-limited" alone — the pre-existing OVERLAP_LOCK doc comment above also happens to
  // contain "rate-limited upstreams", which would otherwise false-positive-match earlier in the file.)
  const skipIdx = routeSrc.indexOf("reason: `rate-limited");
  assert.ok(skipIdx > cooldownIdx && skipIdx < dispatchIdx);

  // Fails OPEN on a Redis error — same posture as OVERLAP_LOCK, so a Redis blip can't wedge the
  // cron shut entirely (a missed rate limit is safer than a stuck cron).
  assert.match(
    routeSrc,
    /sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY[\s\S]{0,80}\)\.catch\(\(\) => true\)/,
    "a Redis error on the cooldown claim must not permanently block every future warm"
  );

  // Unlike OVERLAP_LOCK, the cooldown key must NOT be deleted early on completion — it has to
  // persist for its full TTL so the floor holds regardless of how fast an individual run finishes
  // (the exact gap that let the pathological pattern above run at a 40s median instead of >=60s).
  assert.doesNotMatch(
    routeSrc,
    /sharedCacheDel\(RERUN_COOLDOWN_KEY\)/,
    "the cooldown must expire on its own TTL, not be released early like the overlap lock"
  );
});

// Behavioral proof (not just source text): app/api/*/route.ts files can only export the documented
// Next.js route fields (GET, dynamic, runtime, maxDuration, ...) — an extra named export like the
// cooldown constants trips a build-time error — so this exercises the SAME underlying primitive
// (sharedCacheSetNx, real in-memory NX+TTL semantics here since no REDIS_URL is set in tests) with
// the identical key format the route claims, pinned above by the source-text assertions, to prove
// the throttle genuinely refuses a rapid-fire replay rather than merely asserting the code shape.
test("the cooldown primitive genuinely refuses a second claim of the same key inside its TTL", async () => {
  const { sharedCacheSetNx, sharedCacheDel } = await import("@/lib/shared-cache");
  const key = `desk-warm:cooldown:test:${Date.now()}:${Math.random()}`;
  try {
    const first = await sharedCacheSetNx(key, { startedAt: Date.now() }, 60);
    const secondImmediately = await sharedCacheSetNx(key, { startedAt: Date.now() }, 60);
    assert.equal(first, true, "the first force=1 (or normal in-window) call must be allowed to run");
    assert.equal(
      secondImmediately,
      false,
      "a SECOND force=1 replay inside the cooldown window must be refused, not silently re-run"
    );
  } finally {
    await sharedCacheDel(key);
  }
});
