> **kind:** FINDING

## Cron audit query failed: nighthawk-backfill-repair stale between dual UTC bands

| **Status** | FIXED |

### What was broken

Scheduled **Cron audit query** (HTTP watchdog fallback) exited 1 with `problems: nighthawk-backfill-repair` at **2026-11-03 13:58 UTC** (~8:58 AM ET). The job uses a **dual UTC band** schedule (`0 13,14 * * 1-5`) so one tick lands at 9:00 AM ET in both DST offsets. Between the **13:00** and **14:00** ticks, `isInOffScheduleIdleGap` returns false (1h gap < 2h threshold), so a last run from **Friday** still read **stale** before the second band fired — false positive for the morning self-heal cron.

### Fix

`isDualBandDailyCatchupPending()` — true only when the schedule has **exactly two fires that UTC day** and `now` sits between them. Wired into `evaluateJob` `notDueYet` + off-schedule stale suppression (same as long idle gaps).

### Verify

Next weekday cron-audit run between 13:00–14:00 UTC should not flag `nighthawk-backfill-repair` when the prior run was the previous session day.
