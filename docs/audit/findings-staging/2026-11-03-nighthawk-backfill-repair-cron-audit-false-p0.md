# Cron audit query false P0 on nighthawk-backfill-repair between UTC bands — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

Scheduled **Cron audit query** on `main` @ `6220d950` (run `41649123458`) failed:

`problems: nighthawk-backfill-repair`

Watchdog HTTP fallback at **13:59 UTC** (8:59 AM ET, EST). Job schedule `0 13,14 * * 1-5` — the hourly audit runs in the one-hour gap after the 13:00 UTC band (DST coverage; skips in EST) and before the 14:00 UTC band (real 9:00 AM ET run). `isInOffScheduleIdleGap` treated that short gap as "must have run", so a never-logged or weekend-stale job tripped `stale` → CI exit 1.

## Fix

Treat the between-band hour for dual-band `13,14` UTC weekday schedules as schedule-idle in `cron-schedule-window.ts`.

## Verify

`node --import tsx --test src/lib/cron-schedule-window.test.ts src/lib/admin-cron-health.test.ts` GREEN.
