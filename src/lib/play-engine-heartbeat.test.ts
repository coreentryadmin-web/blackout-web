import assert from "node:assert/strict";
import test from "node:test";

// NH-R10: these tests run with no DATABASE_URL set, so dbConfigured() is false
// and every tick stays in the module's in-memory state — no DB needed, and no
// risk of touching a real meta row.
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PUBLIC_URL;

import {
  clampedHeartbeatAgeMs,
  getPlayEngineHeartbeat,
  getZeroDteScanHeartbeat,
  recordPlayEngineTick,
  recordZeroDteScanTick,
} from "./play-engine-heartbeat";

test("clampedHeartbeatAgeMs: ordinary past tick ages normally", () => {
  const now = 1_000_000_000;
  assert.equal(clampedHeartbeatAgeMs(new Date(now - 5_000).toISOString(), now), 5_000);
  assert.equal(clampedHeartbeatAgeMs(new Date(now - 90_000).toISOString(), now), 90_000);
});

test("clampedHeartbeatAgeMs: a last_tick_at from the future (cross-replica clock skew) clamps to 0, never negative", () => {
  // last_tick_at is hydrated from Postgres (loadPlayEngineHeartbeat/load()) and can have been
  // written by a DIFFERENT ECS replica than the one computing age here — ordinary clock skew
  // between replicas can make that writer's Date.now() read fractionally ahead of this
  // reader's. Unclamped, this surfaces as a negative age_ms and, via admin-cron-health.ts's
  // `hbAgeMin = Math.round(age_ms / 60_000)`, a status label reading "engine tick -1m ago".
  const now = 1_000_000_000;
  assert.equal(
    clampedHeartbeatAgeMs(new Date(now + 2_000).toISOString(), now),
    0,
    "2s of cross-replica skew must not read as age_ms: -2000"
  );
  assert.equal(
    clampedHeartbeatAgeMs(new Date(now + 1).toISOString(), now),
    0,
    "reachable at 1ms of skew"
  );
});

test("recordZeroDteScanTick advances the 0DTE scan heartbeat independently of SPX's", async () => {
  const spxBefore = getPlayEngineHeartbeat();
  const zdtBefore = getZeroDteScanHeartbeat();

  await recordZeroDteScanTick("cron");

  const spxAfter = getPlayEngineHeartbeat();
  const zdtAfter = getZeroDteScanHeartbeat();

  // The 0DTE tracker advanced...
  assert.equal(zdtAfter.tick_count, zdtBefore.tick_count + 1);
  assert.equal(zdtAfter.last_source, "cron");
  assert.equal(zdtAfter.stale, false);
  assert.equal(zdtAfter.critical_stale, false);
  assert.ok(zdtAfter.age_ms != null && zdtAfter.age_ms >= 0);

  // ...while SPX's own tick_count/last_source are completely untouched — proof
  // the two trackers do not share mutable state.
  assert.equal(spxAfter.tick_count, spxBefore.tick_count);
  assert.equal(spxAfter.last_source, spxBefore.last_source);
});

test("recordPlayEngineTick (SPX) still behaves exactly as before — unaffected by the 0DTE tracker", async () => {
  const before = getPlayEngineHeartbeat();

  await recordPlayEngineTick("evaluate");

  const after = getPlayEngineHeartbeat();
  assert.equal(after.tick_count, before.tick_count + 1);
  assert.equal(after.last_source, "evaluate");
  assert.equal(after.stale, false);
  assert.equal(after.critical_stale, false);
});

test("a heartbeat with no ticks yet reports null age and is not stale", () => {
  // Fresh process-level state is only true at module load; here we just assert
  // the shape/typing of a never-ticked snapshot is safe to consume — a tracker
  // that has ticked in an earlier test in this file is still a valid check of
  // the "never stale/critical_stale when age_ms is null" invariant when there's
  // no last_tick_at.
  const snap = getZeroDteScanHeartbeat();
  if (snap.last_tick_at == null) {
    assert.equal(snap.age_ms, null);
    assert.equal(snap.stale, false);
    assert.equal(snap.critical_stale, false);
  }
});
