> **kind:** FINDING

## Cron audit query failed on never-run `nighthawk-backfill-repair` before 9 AM ET window — FIXED

**Status:** FIXED (`fix/query-nighthawk-backfill-repair-stale`)

### Root cause

`GET /api/cron/cron-staleness-watchdog` reported `nighthawk-backfill-repair` as stale
(`problems: nighthawk-backfill-repair`) on run **41649123458** @ `6220d950` (~8:59 AM ET /
13:59 UTC). The job had no `cron_job_runs` row yet (EventBridge rule still rolling out on
some fleets). Health treated that as stale in the narrow gap between the dual-band UTC fires
instead of "not due until the 9:00 AM ET repair window."

### Fix

- Suppress stale/failed for that key before 10:45 AM ET on trading days
  (`nighthawkBackfillRepairAwaitingMorningRun`).
- Register the handler in `CRON_DISPATCH` + watchdog self-heal targets.
- `nighthawk-morning-confirm` dispatches `nighthawk-backfill-repair` before verdicts so prod
  gets a logged run even when the dedicated schedule is missing.

### Evidence

- CI log: `problems: nighthawk-backfill-repair`, `checked: 50`, run 41649123458.
- `src/lib/admin-cron-health.test.ts` — pre-window helper.
- `src/lib/cron-schedule-window.test.ts` — pre-13:00 UTC idle gap for `0 13,14 * * 1-5`.
