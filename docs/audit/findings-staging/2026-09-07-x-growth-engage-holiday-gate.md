# x-growth / x-engage missing NYSE holiday gate — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | cron / X marketing |
| **PR** | (pending) |

## Symptom

Labor Day 2026-09-07: `x-replies` and desk-post crons correctly skipped via `isTradingDayEt`, but `x-growth` (hourly weekday FinTwit engagement sweep) and `x-engage` (manual engagement sweep) had no trading-day gate and would fire on NYSE holidays when invoked.

## Root cause

#4500 gated `x-replies` and desk posts (`x-autopost`, `x-intel` via `isPostWindow`) but left sibling engagement sweeps ungated.

## Fix

Add `isTradingDayEt(sessionDay)` skip with `force=1` bypass to both routes, matching `x-replies` pattern. Regression tests lock gate ordering.

## Verify

- `npx tsx --test src/app/api/cron/x-growth/route.holiday-gate.test.ts`
- `npx tsx --test src/app/api/cron/x-engage/route.holiday-gate.test.ts`
