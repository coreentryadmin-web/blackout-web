> **kind:** `FINDING`

## Deploy smoke false RED — transient 502 on SPX desk post-rollout (2026-11-09)

| **Status** | FIXED (smoke harness) |
|------------|----------------------|

**Symptom:** `deploy-smoke` run **42550161810** on `0dee31c5`: all public checks green, then `✗ /api/market/spx/desk → unexpected HTTP 502`.

**Root cause:** Smoke probed the heavy desk route once immediately after `/api/health` was already 200. A cold replica can still return route-level **502** (`Desk build failed`) for a few seconds while the lightweight health routes succeed. Single-attempt probe treated that as a broken deploy.

**Fix:** `isTransientDeskProbeStatus` + up to 5 attempts (8s apart, env-overridable) on 429/502/503/504 before final fail.

**Blast radius:** `deploy-smoke`, RTH smoke workflows using `gha-http-smoke.mjs`.
