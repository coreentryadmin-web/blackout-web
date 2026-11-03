> **kind:** `FINDING`

## 2026-11-03 — `query` CI: `nighthawk-backfill-repair` flagged stale/failed by cron-staleness-watchdog — FIXED

| **Status** | Fixed (PR pending) |
|------------|-------------------|
| **Area** | `nighthawk-backfill-repair` EventBridge catalog + cron-health dual-band suppression |
| **Symptom** | Scheduled `cron-audit-query` on `main` (run 41649123458, commit `6220d950`) exited 1: `problems: nighthawk-backfill-repair` via HTTP watchdog fallback (not a transport 520). |
| **Root cause** | Two issues: (1) Job was registered in `cron-registry.ts` + `railway.nighthawk-backfill-repair.toml` but **missing from `scripts/railway-cron-services.mjs` `CRON_SERVICE_NAMES`**, so `blackout-infra` sync never provisioned EventBridge — zero production `cron_job_runs`. (2) Dual-band schedule `0 13,14 * * 1-5` leaves a 1h gap where the first UTC band is an intentional off-window skip; health had no “await in-window band” suppression, so hourly `query` during 13:05–13:59Z false-paged even when the second band had not fired yet. |
| **Fix** | Added `nighthawk-backfill-repair` → `NightHawk-Backfill-Repair` in `CRON_SERVICE_NAMES`; `isInDualBandInterFireGap()` + `evaluateJob()` suppression; route off-window payload `ok: true, skipped: true`. |
| **Verify after deploy** | Run `blackout-infra` `sync-cron-schedules.mjs`; confirm `GET /api/admin/cron-health` shows `last_run_at` for `nighthawk-backfill-repair` after 14:00 UTC on a weekday; `npm run validate:cron` / next hourly `query` GREEN. |
