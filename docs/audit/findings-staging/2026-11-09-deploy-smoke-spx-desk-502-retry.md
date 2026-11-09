> **kind:** FINDING

## deploy-smoke false-red on transient `/api/market/spx/desk` 502 post-deploy

| **Status** | FIXED (this PR) |
|------------|-----------------|
| **Detected** | deploy-smoke run 42550161810 on `main` @ `0dee31c5` (2026-11-09 ~02:20 UTC) |
| **Symptom** | Cron-authed desk probe `unexpected HTTP 502` while health/ready/public routes were green |
| **Root cause** | Single-shot desk probe; cold replica or in-flight desk build can 502 once during ECS rollout |
| **Fix** | `shouldRetrySpxDeskProbe()` + up to 5 attempts (3s backoff) in `gha-http-smoke.mjs` before verdict |
| **Verify** | `npx tsx --test scripts/lib/gha-desk-smoke-eval.test.ts`; next `main` deploy-smoke |
