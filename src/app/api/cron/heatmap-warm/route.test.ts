// Regression: heatmap-warm must not run overlapping warm passes across replicas.
//
// Measured live 2026-09-03 (48h, /ecs/blackout-production, n=1000 leader-dispatched runs of this
// exact handler): p50=46.5s, p90=81.1s, p99=181.1s, max=209.2s — every run finishes well past the
// rth-warm-leader's 20s heal threshold for this cron, so the leader treats it as perpetually
// overdue and re-dispatches on almost every cycle, landing a second full warm pass on top of one
// already in flight, both sweeping the same shared universe through the same Polygon rate
// limiters. Same `sharedCacheSetNx` idempotent-skip pattern already used by
// vector-pick-sweep/swing-discovery/banger-discovery/thermal-discord for this exact shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("heatmap-warm acquires a cross-replica overlap lock before running the warm pass", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before the warm pass, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of running a second warm pass", () => {
  assert.match(routeSrc, /skipped: true,\s*\n\s*reason: "previous warm still in flight/);
  // The skip branch must return before reaching the actual warm work, not alongside it.
  const skipIdx = routeSrc.indexOf('reason: "previous warm still in flight');
  const runIdx = routeSrc.indexOf("runHeatmapWarm(req, started)");
  assert.ok(skipIdx > 0 && runIdx > 0 && skipIdx < runIdx);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the cron shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,120}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future warm pass"
  );
});

test("the lock is released in a finally block so a thrown warm pass still frees the next run", () => {
  const finallyBlock = /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
});

test("the lock TTL (240s) comfortably covers the measured max runtime (209.2s)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 240/);
});

// Regression: force=1 must not be an UNTHROTTLED bypass of the hours gate. Same structural gap
// fixed for desk-warm in #3540 — OVERLAP_LOCK guards only against a SECOND run starting while the
// FIRST is still in flight, and releases the instant that run completes. On an already-warm
// universe ("warm names are Redis-cache-first (near-free)", this file's own header comment) that
// can be well under the p50=46.5s measured for a cold sweep, so a caller replaying `?force=1` in a
// tight loop could re-trigger the full shared-universe Polygon fan-out far faster than any
// legitimate trigger (rth-warm-leader's own 20s heal threshold, the tightest of any watched key,
// or EventBridge's own ~30-45s schedule) with nothing in the route capping the rate.
test("force=1 is rate-limited by a minimum re-run cooldown, independent of the hours gate", () => {
  assert.match(routeSrc, /RERUN_COOLDOWN_SEC = 10/, "the floor must exist and be tuned below rth-warm-leader's 20s heal threshold for this key");
  assert.match(routeSrc, /RERUN_COOLDOWN_KEY = "heatmap-warm:cooldown"/, "must be a key distinct from OVERLAP_LOCK_KEY");

  // Must be claimed via the same atomic NX primitive as the overlap lock (no read-then-write race).
  assert.match(
    routeSrc,
    /const withinCooldown = !\(await sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY,/,
    "the cooldown claim must be atomic, not a separate read-then-write"
  );

  // Ordering: cooldown is checked BEFORE the overlap lock and BEFORE the warm pass, so a
  // rate-limited caller never even reaches the overlap-lock claim or the Polygon fan-out.
  const cooldownIdx = routeSrc.indexOf("RERUN_COOLDOWN_KEY,");
  const overlapClaimIdx = routeSrc.indexOf("const acquired = await sharedCacheSetNx(");
  const runIdx = routeSrc.indexOf("runHeatmapWarm(req, started)");
  assert.ok(cooldownIdx > 0 && overlapClaimIdx > 0 && runIdx > 0);
  assert.ok(cooldownIdx < overlapClaimIdx, "cooldown must be checked before the overlap lock");
  assert.ok(overlapClaimIdx < runIdx, "overlap lock must still be checked before the warm pass");

  // The rate-limited skip must actually return, not just log — same "return before running the
  // warm pass" shape as the existing overlap-lock skip test above. Match the literal skip-payload
  // reason (not the bare word "rate-limited"), since other doc comments in this file also contain
  // that word and would otherwise false-positive-match earlier in the source.
  const skipIdx = routeSrc.indexOf("reason: `rate-limited");
  assert.ok(skipIdx > cooldownIdx && skipIdx < runIdx);

  // Fails OPEN on a Redis error — same posture as OVERLAP_LOCK, so a Redis blip can't wedge the
  // cron shut entirely (a missed rate limit is safer than a stuck cron).
  assert.match(
    routeSrc,
    /sharedCacheSetNx\(\s*RERUN_COOLDOWN_KEY[\s\S]{0,80}\)\.catch\(\(\) => true\)/,
    "a Redis error on the cooldown claim must not permanently block every future warm pass"
  );

  // Unlike OVERLAP_LOCK, the cooldown key must NOT be deleted early on completion — it has to
  // persist for its full TTL so the floor holds regardless of how fast an individual run finishes.
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
  const key = `heatmap-warm:cooldown:test:${Date.now()}:${Math.random()}`;
  try {
    const first = await sharedCacheSetNx(key, { startedAt: Date.now() }, 10);
    const secondImmediately = await sharedCacheSetNx(key, { startedAt: Date.now() }, 10);
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
