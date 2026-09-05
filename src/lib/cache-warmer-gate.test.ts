import { test } from "node:test";
import assert from "node:assert/strict";

test("shouldRunCacheWarmer: force always runs", async () => {
  delete process.env.CACHE_WARM_ALWAYS;
  const { shouldRunCacheWarmer } = await import("./cache-warmer-gate");
  assert.equal(shouldRunCacheWarmer(true), true);
});

test("shouldRunCacheWarmer: a leftover CACHE_WARM_ALWAYS env var no longer bypasses hours", async () => {
  // Regression pin for a real bug: CACHE_WARM_ALWAYS was a staging-only escape hatch (staging
  // was decommissioned 2026-07-25), but the production secret still carried CACHE_WARM_ALWAYS=1
  // as a leftover — confirmed live 2026-09-04 — which silently bypassed isEtExtendedWarmHours
  // for all four warm crons sharing this gate (desk-warm/zerodte-warm/heatmap-warm/meridian-warm),
  // making them run 24/7 instead of the intended weekday 4am-8pm ET window. Measured overnight
  // impact: dozens of 10-33s desk-warm background runs, ECS CPU Max spiking 80-90% against a
  // 2-8% average, and ALB TargetResponseTime p99 1.7-3.6s / Max 9-41s while p50/p90 stayed
  // healthy — the tail-latency signature of one saturating background job, not fleet capacity.
  // Even with the leftover env var still set (until the stale secret value is cleaned up
  // separately), the gate must now be governed ONLY by hours or an explicit ?force=1.
  process.env.CACHE_WARM_ALWAYS = "1";
  const { shouldRunCacheWarmer } = await import("./cache-warmer-gate");
  assert.equal(
    shouldRunCacheWarmer(false, new Date("2026-07-08T07:00:00Z")),
    false,
    "a stale CACHE_WARM_ALWAYS=1 must not bypass the hours gate anymore"
  );
  assert.equal(
    shouldRunCacheWarmer(false, new Date("2026-07-08T10:00:00Z")),
    true,
    "10:00 UTC is inside the 4am-8pm ET window on 2026-07-08 (EDT) — sanity check the fixture"
  );
  delete process.env.CACHE_WARM_ALWAYS;
});

test("shouldRunCacheWarmer: logs the cron key when force overrides an active off-hours block", async () => {
  // A force=1 bypass is legitimate (on-demand/debug warms), so the gate can't just refuse it —
  // but an UNMONITORED caller hammering force=1 off-hours reproduces the exact CACHE_WARM_ALWAYS
  // symptom (a warm cron running 24/7) through a mechanism this gate has no way to close outright.
  // The fix is visibility: every such bypass must log which key it was, so a future off-hours
  // saturation incident is one CloudWatch grep away instead of a Secrets Manager hand-audit.
  const { shouldRunCacheWarmer } = await import("./cache-warmer-gate");
  const offHours = new Date("2026-07-08T07:00:00Z"); // 03:00 ET — outside the 4am-8pm window
  const inHours = new Date("2026-07-08T10:00:00Z"); // 06:00 ET — inside the window

  const originalInfo = console.info;
  const calls: unknown[][] = [];
  console.info = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    calls.length = 0;
    shouldRunCacheWarmer(true, offHours, "desk-warm");
    assert.equal(calls.length, 1, "force overriding an active off-hours block must log once");
    assert.match(String(calls[0][0]), /force=1 bypassed the hours gate for 'desk-warm'/);

    calls.length = 0;
    shouldRunCacheWarmer(true, inHours, "desk-warm");
    assert.equal(calls.length, 0, "force during legitimate hours is a no-op override — nothing to log");

    calls.length = 0;
    shouldRunCacheWarmer(false, offHours, "desk-warm");
    assert.equal(calls.length, 0, "a plain off-hours skip (no force) is expected behavior — not a bypass");
  } finally {
    console.info = originalInfo;
  }
});
