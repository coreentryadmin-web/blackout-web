# 2026-11-06 — cron-audit `query` RED: SPX crons vs cash-RTH health gate — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Priority** | P1 — hourly `query` / watchdog false RED |
| **Found by** | CI `query` (Cron audit) failure on `main` (`spx-evaluate`, `spx-issues-sync`) |
| **Status** | FIXED — align `market_hours_only` staleness with `isSpxEngineCronWindow` (7:00–16:15 ET) for those keys |

### Root cause

`evaluateJob` and the `spx-evaluate` heartbeat cross-check treated `market_hours_only` jobs as in-session only when **cash RTH** (`isEtCashRth`, 9:30–16:00 ET). The routes for **`spx-evaluate`** and **`spx-issues-sync`** gate real work with **`isSpxEngineCronWindow`** (7:00–16:15 ET). Outside cash RTH but inside the engine window (pre-market and post-close tail), the health layer suppressed stale handshakes or inverted “off-window” vs route behavior — producing **`query`** RED on scheduled CI.

### Fix

- `src/lib/admin-cron-health.ts` — `inCronMarketHoursWindow()` uses `isSpxEngineCronWindow` for `spx-evaluate` / `spx-issues-sync`; other `market_hours_only` jobs keep cash RTH. `zerodte-warm` heartbeat block keeps **`inCashRthEt()`** (unchanged).

### Test

- `npx tsx --test src/lib/admin-cron-health.test.ts` — adds fixed-clock cases: post-close engine window stale `spx-evaluate`; pre-market `flow-ingest` off-window.
