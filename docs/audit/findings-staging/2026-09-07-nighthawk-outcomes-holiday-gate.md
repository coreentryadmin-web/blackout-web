# nighthawk-outcomes graded on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-nighthawk-outcomes-holiday-gate |
| **Priority** | P2 |
| **Area** | Cron infra / Night Hawk outcome grading |
| **Status** | FIXED |

## Symptom

Post-#4490/#4491 holiday-gate sweep: `nighthawk-outcomes` still runs its 16:30 ET
outcome/debrief pass on NYSE holidays when EventBridge fires inside the catchup window
(e.g. Labor Day 2026-09-07).

## Root cause

`inEtWindow()` only excludes Sat/Sun — no `isTradingDayEt()` check. Registry weekday
schedule does not exclude NYSE holidays.

## Fix

Added `isTradingDayEt(sessionDay)` gate after auth and before the ET window guard;
`force=1` bypasses for ops recovery (same pattern as nighthawk-morning-confirm).

## Blast radius

`nighthawk-outcomes` route only. Post-close window behavior on trading days unchanged.

## Evidence

RED→GREEN static test: `npx tsx --test src/app/api/cron/nighthawk-outcomes/route.test.ts`
