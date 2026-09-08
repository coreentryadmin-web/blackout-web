# swing-discovery polled Polygon+UW on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-swing-discovery-holiday-gate |
| **Priority** | P2 |
| **Area** | Cron infra / UW+Polygon rate budget |
| **Status** | FIXED |

## Symptom

Post-#4484 holiday-gate sweep: `swing-discovery` still executed whole-market Polygon+UW
discovery on Labor Day 2026-09-07 when EventBridge fired inside a phase window (e.g.
PRE_OPEN 6:00–9:15 AM ET).

## Root cause

`decideSwingScan()` resolves phase windows from ET wall clock only — no
`isTradingDayEt()` check. Registry `weekdays_only: true` does not exclude NYSE holidays.

Unlike `swing-active-refresh`, this route cannot use `isEtCashRth()` because POST_CLOSE
(4:15–8:00 PM ET) and OVERNIGHT (8:00 PM–midnight) intentionally run outside cash RTH.

## Fix

Added `isTradingDayEt(sessionDay)` gate after auth; `force=1` bypasses for ops recovery
(same pattern as `nighthawk-morning-confirm`).

## Blast radius

`swing-discovery` route only. Trading-day phase behavior unchanged.

## Evidence

RED→GREEN static test in `route.test.ts`:
`npx tsx --test src/app/api/cron/swing-discovery/route.test.ts`
