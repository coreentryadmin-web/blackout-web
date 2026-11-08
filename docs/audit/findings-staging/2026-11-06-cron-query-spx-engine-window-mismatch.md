# Cron audit query RED — SPX engine crons vs cash RTH in admin health

> **kind:** `FINDING`

| **Status** | FIXED (PR pending) |
|------------|-------------------|

### Symptom

CI **`query`** failed with `problems: spx-evaluate, spx-issues-sync` when those routes were skipping or ticking inside the SPX engine window but outside cash RTH.

### Root cause

`evaluateJob` and snapshot overrides used **`isEtCashRth`** for all `market_hours_only` jobs. **`spx-evaluate`** and **`spx-issues-sync`** gate on **`isSpxEngineCronWindow`** (7:00–16:15 ET).

### Fix

Add **`cronMarketHoursOpen(job, now)`** for those keys; wire through **`evaluateJob`** and **`buildCronHealthSnapshot`** heartbeat paths.

### Verify

`npx tsx --test src/lib/admin-cron-health.test.ts`; **`query`** CI green after deploy.
