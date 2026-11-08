> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | Cron audit query P0 Saturday on post-close weekday crons |
| **Status** | FIXED |

## What broke

`cron-audit-query` run **42483568215** (Sat 2026-11-08 13:10 UTC): watchdog problems `nighthawk-outcomes`, `gex-eod-snapshot`, `banger-discovery`. Jobs are `weekdays_only` with no Saturday UTC fires; Friday stale/failed still counted.

## Fix

`evaluateJob`: on non-trading ET days, inside `isInOffScheduleIdleGap` for `schedule_cron_utc`, downgrade `stale`/`failed` → healthy (admin + query share snapshot).

## Verify

`npx tsx --test src/lib/admin-cron-health.test.ts` weekend case; next scheduled query on Mon.
