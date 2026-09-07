# Admin cron health false-stale on NYSE holidays — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P3 |
| **Area** | ops / admin cron health board |
| **PR** | fix/admin-cron-health-holiday-stale |

## Symptom

On NYSE weekday holidays (Labor Day 2026-09-07), `weekdays_only` / `market_hours_only` crons correctly gate and log `skipped` — but `admin-cron-health.ts` `effectiveStaleMinutes()` used `isWeekdayEt()` only. Holidays read as normal weekdays → strict 15-minute stale ceiling → false `market_hours_stale` flags on the admin Operations board.

## Root cause

`effectiveStaleMinutes` relaxed multipliers (2.5× / 6×) applied only when `!isWeekdayEt()` (weekends). NYSE holidays are weekdays but not trading days.

## Fix

Switch to `isTradingDayEt(formatEtDate(now))` so holidays get the same relaxed thresholds as weekends — aligned with execution gates shipped in #4517–#4520.

## Evidence

- `npx tsx --test src/lib/admin-cron-health.test.ts` — Labor Day regression tests pass
- Pre-fix: Labor Day test would expect multiplier 1 (strict); post-fix multiplier 6
