# X marketing crons posted desk-cycle content on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-x-marketing-holiday-gate |
| **Priority** | P2 |
| **Area** | Cron infra / X marketing lane |
| **Status** | FIXED |

## Symptom

Post-#4490–#4494 holiday-gate sweep: `x-autopost` and `x-intel` use `isPostWindow()` /
`selectPostType()` in `x-content-schedule.ts`, which only excluded Sat/Sun — not NYSE holidays.
On Labor Day 2026-09-07 the weekday EventBridge schedule could still select `desk_open` /
`desk_flow` / etc. and post public desk-cycle tweets from cached market data. `x-replies` had
no trading-day gate at all.

## Root cause

Same ET-INTENT class as other holiday gaps: weekday EventBridge schedule + ET hour bands
without NYSE calendar awareness.

## Fix

- `x-content-schedule.ts`: `isPostWindow()` checks `isTradingDayEt(todayEt(nowEt))` for
  weekday desk posts (weekend `weekend_desk` slots unchanged).
- `x-replies/route.ts`: skip with `non-trading day` unless `force=1` (ops recovery).

## Blast radius

X marketing lane only. Trading-day post cadence unchanged; weekend posts unchanged.

## Evidence

RED→GREEN: `npx tsx --test src/lib/x-content-schedule.test.ts` — new Labor Day + Saturday cases.
