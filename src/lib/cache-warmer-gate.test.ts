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
