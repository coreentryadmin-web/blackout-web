## 2026-11-09 — Deploy smoke failed on transient SPX desk 502 post-rollout — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | `Deploy smoke` on `main` @ `0dee31c5` failed with `✗ /api/market/spx/desk → unexpected HTTP 502` while `/api/health` and `/api/ready` were green. |
| **Root cause** | Single-shot cron probe ran during ALB/ECS drain; cold `buildSpxDesk` can 502 once right after health polls green. |
| **Fix** | `withTransientRetry` on the desk probe (502/503/504/524, 6×5s default) before `evaluateSpxDeskSmoke`. |
| **Status** | Fixed — `scripts/lib/gha-transient-http.mjs` + wired in `gha-http-smoke.mjs`. |
