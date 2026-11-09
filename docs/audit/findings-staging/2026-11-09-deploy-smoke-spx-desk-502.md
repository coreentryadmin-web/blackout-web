## 2026-11-09 — deploy smoke SPX desk 502 @ main 0dee31c5

> **kind:** `FINDING`

| **Status** | FIXED in PR #7670 |
| --- | --- |
| **What broke** | Post-merge deploy smoke: cron `/api/market/spx/desk` returned HTTP 502 once while ECS rolled; single-shot probe failed smoke though `/api/health` was green. |
| **Fix** | Retry 502/503/504 up to 5 attempts; off-hours structured "Desk build failed" 502 → warn, not fail. |
