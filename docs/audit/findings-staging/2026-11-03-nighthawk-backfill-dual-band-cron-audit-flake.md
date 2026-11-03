# Cron audit false fail on nighthawk-backfill-repair dual-band gap — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
| --- | --- |

## What broke

`Cron audit query` run [41649123458](https://github.com/coreentryadmin-web/blackout-web/actions/runs/41649123458) @ `6220d950` (2026-11-03 13:59 UTC): watchdog HTTP fallback reported `problems: nighthawk-backfill-repair`. Prod `/api/health` 200.

## Root cause

Dual-band DST schedule `0 13,14 * * 1-5`: on EST days the 13:00 UTC tick is before the route's 9:00 ET window; the real run is 14:00 UTC. Between those fires, `isInOffScheduleIdleGap` is false (1h gap), so a job with **no** logged run evaluated as **stale** instead of **unknown** — tripping cron-audit before the in-window fire.

## Fix

`isInSameDayDualBandGap()` in `cron-schedule-window.ts`; wire into `evaluateJob`'s `notDueYet` gate in `admin-cron-health.ts`.

## Verify

`npx tsx --test src/lib/cron-schedule-window.test.ts src/lib/admin-cron-health.test.ts`
