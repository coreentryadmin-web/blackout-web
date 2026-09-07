# zerodte-grade ran post-close grading on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-zerodte-grade-holiday-gate |
| **Priority** | P2 |
| **Area** | Cron infra / 0DTE ledger grading |
| **Status** | FIXED |

## Symptom

Post-#4490/#4491/#4492 holiday-gate sweep: `zerodte-grade` still runs post-close
ledger grading + calibration rail refresh on NYSE holidays when EventBridge fires
during the 16:30–20:00 ET window (e.g. Labor Day 2026-09-07).

## Root cause

No `isTradingDayEt()` check — route runs whenever authorized. Weekday-only
EventBridge schedule does not exclude NYSE holidays.

## Fix

Added `isTradingDayEt(sessionDay)` gate after auth; `force=1` bypasses for ops recovery.

## Blast radius

`zerodte-grade` route only.

## Evidence

RED→GREEN static test: `npx tsx --test src/app/api/cron/zerodte-grade/route.test.ts`
