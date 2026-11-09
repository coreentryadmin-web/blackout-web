> **kind:** `FINDING`

## 2026-11-09 — Deploy smoke: transient 502 on `/api/market/spx/desk` during ECS rollout — FIXED

| **Status** | Fixed |
|------------|-------|
| **Symptom** | `Deploy smoke` on `main` (runs **42548713697**, **42550161810**, commit `0dee31c5`) failed: `unexpected HTTP 502` on cron-authed desk probe while public routes were green. |
| **Root cause** | `evaluateSpxDeskSmoke` correctly flags 502 as fail, but `gha-http-smoke.mjs` probed once ~2m post-merge — often while an old task drained or a cold replica was still building the desk. Separately, `buildSpxDeskPulseMinimal` still skipped blocking `fetchPriorDayCached` off-hours, yielding `price:0` shells on weekends. |
| **Fix** | Retry desk up to 5× (3s apart) on 502/503/504; re-apply off-hours prior-close await in minimal pulse. |
| **Verify** | `node --import tsx --test scripts/lib/gha-desk-smoke-eval.test.ts`; next merge during off-hours should not red on a single 502. |
