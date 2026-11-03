> **kind:** FINDING

## `nighthawk-backfill-repair` never scheduled in prod — morning-confirm piggyback + dispatch — FIXED

| | |
|---|---|
| **Area** | `nighthawk-backfill-repair` cron health / Legacy BACKFILL self-heal |
| **Status** | FIXED — regression tests added |
| **Severity** | P1 (CI `query` red + member-facing dead BACKFILL contracts when repair never runs) |

### Root cause

The repair route and `railway.nighthawk-backfill-repair.toml` shipped 2026-10-25, but production
`cron_job_runs` for `nighthawk-backfill-repair` stayed empty (`last_run_at=null`, `runs_24h` all
zero) while sibling `nighthawk-morning-confirm` fired every session — the EventBridge rule for the
dedicated repair cron was never provisioned (same class as prior registry↔infra drift incidents).

During Mon RTH pre-open (UTC 13:00–14:30), `admin-cron-health` evaluates a never-run job as
`stale`, so `cron-staleness-watchdog` surfaces it in `problem_keys` and CI `query` fails.

### Fix

1. Register `nighthawk-backfill-repair` in `CRON_DISPATCH` (`force: true`) for admin re-run and
   watchdog self-heal.
2. `nighthawk-morning-confirm` calls `dispatchCronWarm("nighthawk-backfill-repair")` before fetching
   the edition row (idempotent; logs via the repair route's own `logCronRun`).
3. Watchdog self-heal includes stale `nighthawk-backfill-repair` when `CRON_WATCHDOG_SELF_HEAL=1`.

Infra should still add the standalone EventBridge rule from `railway.nighthawk-backfill-repair.toml`
so the ideal 9:00 ET timing is restored; this code path is the safety net until then.

### Evidence

Live `GET /api/admin/cron-health` (2026-11-03): `nighthawk-backfill-repair` `last_run_at=null`;
`nighthawk-morning-confirm` `last_run_at` same day 13:15Z. CI `query` on `6220d950`: `problems:
nighthawk-backfill-repair`.
