> **kind:** FINDING

## nighthawk-backfill-repair watchdog stale — delegate from morning-confirm

| **Status** | FIXED (pending merge + prod deploy) |

**Symptom:** `Cron audit query` failed: `problems: nighthawk-backfill-repair` via HTTP watchdog (2026-11-03 ~13:59 UTC).

**Root cause:** Dedicated EventBridge rule for `nighthawk-backfill-repair` not yet provisioned in prod (registry/TOML existed; `cron_job_runs` never logged). Watchdog correctly reported `stale` / never-run past the 13:00 UTC band.

**Fix:** Extract `runNighthawkBackfillRepairJob` and invoke it from `nighthawk-morning-confirm` before edition fetch (logs under `nighthawk-backfill-repair`, `delegated_from: nighthawk-morning-confirm`). Dedicated cron route unchanged behavior via shared job.

**Verify after deploy:** `GET /api/admin/cron-health` shows recent `nighthawk-backfill-repair` run on weekday mornings; `npm run validate:cron` green.
