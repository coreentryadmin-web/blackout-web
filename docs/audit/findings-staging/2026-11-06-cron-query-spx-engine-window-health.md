> **kind:** FINDING

## Cron audit query false P0: SPX stack crons flagged stale premarket vs cash-RTH gate — FIXED

| **Status** | FIXED |

**Symptom:** Scheduled `Cron audit query` (**2026-11-06 ~17:54 UTC** ≈ 12:54 ET) reported `problems: spx-evaluate, spx-issues-sync` via HTTP watchdog.

**Root cause:** `evaluateJob` treated `market_hours_only` as **cash RTH only** (`isEtCashRth` 9:30–4:00 ET). Those routes actually gate on **`isSpxEngineCronWindow`** (7:00–16:15 ET). Premarket (e.g. 7:30–9:29 ET) is **on** for the cron but **off** for cash RTH — last successful run looked “stale” vs `stale_after_min` while the job was legitimately idle, tripping `market_hours_stale` and CI.

**Fix:** `inMarketHoursForCronJob(job)` — SPX-engine-window keys use `isSpxEngineCronWindow`; others keep `isEtCashRth`.

**Verify:** `node --import tsx --test src/lib/admin-cron-health.test.ts`; next hourly cron-audit during premarket should not list those keys.
