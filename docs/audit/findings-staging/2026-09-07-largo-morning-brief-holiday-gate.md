# largo-morning-brief pushed on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-morning-brief-holiday-gate |
| **Priority** | P2 |
| **Area** | Cron infra / Largo morning brief push |
| **Status** | FIXED |

## Symptom

Post-#4490–#4498 holiday-gate sweep: `largo-morning-brief` had an `inEtWindow` gate for the
dual-band UTC schedule but no `isTradingDayEt()` check. On NYSE holidays (e.g. Labor Day
2026-09-07), EventBridge weekday fires inside the 9:25 ET catchup window still build/push the
morning brief against a closed tape.

## Root cause

Same class as `nighthawk-morning-confirm` pre-fix: registry `weekdays_only: true` and
`inEtWindow` only exclude weekends, not NYSE holidays.

## Fix

Added `isTradingDayEt(sessionDay)` gate after auth and before the ET window guard;
`force=1` bypasses for ops recovery (same pattern as `nighthawk-morning-confirm`).

## Blast radius

`largo-morning-brief` route only. In-window behavior on trading days unchanged.

## Evidence

RED→GREEN: `npx tsx --test src/app/api/cron/largo-morning-brief/route.test.ts src/app/api/cron/largo-morning-brief/route.holiday-gate.test.ts`
