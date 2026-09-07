# largo-morning-brief runs on NYSE holidays despite morning ET window gate — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-largo-morning-brief-holiday-gate |
| **Priority** | P3 |
| **Area** | Cron infra / member push |
| **Status** | FIXED |

## Symptom

Post-#4490–#4494 holiday-gate sweep: `largo-morning-brief` had an `inEtWindow` gate for the
dual-band UTC schedule but no `isTradingDayEt()` check. On NYSE holidays (e.g. Labor Day
2026-09-07), EventBridge weekday fires inside the 9:25 ET catchup window still build/push the
morning brief against a closed tape.

## Root cause

Same class as `nighthawk-morning-confirm` pre-fix: registry `weekdays_only: true` and
`inEtWindow` only exclude weekends, not NYSE holidays.

## Fix

Added `isTradingDayEt(sessionDay)` gate after the morning window guard; `force=1` bypasses for
ops recovery.

## Blast radius

`largo-morning-brief` route only. Trading-day morning behavior unchanged.

## Evidence

Static-source test in `holiday-gate.test.ts`. `npx tsx --test` on the file — pass.
