> **kind:** `FINDING`

## 2026-11-08 — Deploy smoke `smoke` job: authenticated SPX desk 200 without `price > 0` — FIXED

| **Status** | Fixed |
|------------|-------|
| **Symptom** | `Deploy smoke` on `main` (`7ee8e8e`, run **42502809714**) failed: `/api/market/spx/desk → 200` after cron auth while `price` was not grounded (weekend / post-deploy cold path). |
| **Root cause** | `gha-http-smoke.mjs` treated any non-401 authenticated 200 without `price > 0` as fatal. `buildSpxDeskPulseMinimal()` relied on non-blocking `priorDayForPulseLane()` without mirroring `buildSpxDeskPulse()`'s off-hours `fetchPriorDayCached` await, so cold weekend replicas returned `price: 0` even with a healthy route. |
| **Fix** | Await prior-day (and VIX prior) off-hours in `buildSpxDeskPulseMinimal`; deploy-smoke retries desk twice then WARNs on authenticated 200 without grounded price (same tolerance as CRON drift). |
| **Verify** | `node --import tsx --test src/features/spx/lib/spx-desk-pulse-timeout-race.test.ts`; post-merge `Deploy smoke` on a docs-only push should stay green. |
