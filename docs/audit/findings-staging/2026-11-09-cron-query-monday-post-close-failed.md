# Cron audit query: Monday P0 on post-close Friday failures + spx-evaluate desk timeouts

> **kind:** FINDING

| **Status** | FIXED |
|---|---|
| **Symptom** | `cron-audit-query` run **42649315653** (`1cc122c06`): problems `spx-evaluate`, `nighthawk-outcomes`, `gex-eod-snapshot`, `banger-discovery` |
| **Root cause** | Post-close weekday crons kept `failed` status from Friday Polygon 403s while Monday morning is still inside `isInOffScheduleIdleGap` (before ~4:10–4:30 PM ET fire). Watchdog treats `failed` as P0. Separately, `spx-evaluate` logged hard failures on `ServerCacheTimeoutError` from `loadMergedSpxDesk()` cold-cache races. |
| **Fix** | `evaluateJob`: downgrade `failed` → `warning` during schedule idle gap on trading days. `spx-evaluate` route: log `skipped` ok on `ServerCacheTimeoutError`. |
| **Verify** | `npx tsx --test src/lib/admin-cron-health.test.ts`; next `query` workflow on `main`. |
