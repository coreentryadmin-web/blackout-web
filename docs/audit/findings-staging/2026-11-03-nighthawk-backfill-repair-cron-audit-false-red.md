> **kind:** FINDING

## Cron audit query — nighthawk-backfill-repair pre-window false red — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |

**Symptom:** `query` workflow on `main@6220d950` failed: `problems: nighthawk-backfill-repair` via HTTP cron watchdog (8:59 AM ET / hourly CI band).

**Root cause:** Health treated the job like a continuous warmer. It runs once daily at **9:00 AM ET** (dual UTC band). Hourly `cron-audit-query` before that window saw `NEVER logged` / `failed` (early UTC band + legacy `ok:false` skip rows) as **stale/failed**, which the watchdog escalates to CI exit 1.

**Fix:** Align `evaluateJob` with the route’s ET window (pre-window → `unknown`; inside catchup with no row → `warning`; legacy outside-window failed message → benign). Route outside-window skip now logs `ok: true, skipped: true`.

**Verify:** `npx tsx --test src/lib/admin-cron-health.test.ts`; green `query` on `main` after deploy. After **10:30 AM ET**, an never-scheduled job should still page stale (infra gap unchanged).
