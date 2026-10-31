import { test } from "node:test";
import assert from "node:assert/strict";
import * as apiTelemetryRedisModule from "./api-telemetry-redis";
import { flushTelemetryToRedis, readCrossInstanceTelemetry } from "./api-telemetry-redis";

// `scheduleTelemetryRedisFlush()` (the only thing that ever called `setInterval` and
// populated the module-level `flushTimer`) was removed as verified dead code in commit
// 07b304c4d ("remove verified dead code post-redesign", #889, 2026-07-21) — nothing in the
// repo schedules a periodic flush any more; `flushTelemetryToRedis`/`readCrossInstanceTelemetry`
// are called on demand, per-request, from admin-api-dashboard.ts and market-health.ts instead.
//
// That removal left `clearTelemetryRedisFlush()` (and the `flushTimer` variable it was the
// sole reader/writer of) behind as an orphaned counterpart: with no scheduler left to ever
// set `flushTimer` to a real interval handle, `clearTelemetryRedisFlush()` had become a
// permanent no-op — `flushTimer` could never be anything but `null`, so its body's
// `if (flushTimer)` branch could never run, and the only other work it did
// (`consecutiveMisses = 0; ticksToSkip = 0;`) duplicated the back-off reset
// `flushTelemetryToRedis()` already performs itself on a successful flush. Repo-wide grep
// confirmed zero callers of `clearTelemetryRedisFlush` outside its own declaration before
// removal (it was never exported from an index/barrel, imported by any route, or referenced
// by any test).
//
// This guard fails if that dead no-op is reintroduced without a real scheduler to pair it
// with, rather than relying on a human noticing an unused export again.
test("api-telemetry-redis.ts does not re-export the removed, callerless clearTelemetryRedisFlush", () => {
  const mod: Record<string, unknown> = apiTelemetryRedisModule;
  assert.ok(
    !("clearTelemetryRedisFlush" in mod),
    "clearTelemetryRedisFlush was removed as dead code (its only reason to exist — " +
      "scheduleTelemetryRedisFlush's setInterval — was removed in #889) — re-add only " +
      "alongside a real scheduler that can actually set flushTimer to a live handle"
  );
});

// Sanity check that the on-demand (non-scheduled) call path this module actually uses in
// production still behaves correctly post-cleanup: with no REDIS_URL configured, a flush
// is a safe no-op and a cross-instance read honestly reports "no data" rather than throwing.
test("flushTelemetryToRedis / readCrossInstanceTelemetry still no-op cleanly without REDIS_URL", async () => {
  const prevRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    await assert.doesNotReject(flushTelemetryToRedis());
    const cross = await readCrossInstanceTelemetry();
    assert.equal(cross, null);
  } finally {
    if (prevRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedisUrl;
  }
});
