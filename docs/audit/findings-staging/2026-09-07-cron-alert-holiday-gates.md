# gex-alerts / vector-alerts lack holiday execution gates — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-cron-alert-holiday-gates |
| **Priority** | P3 |
| **Area** | Cron infra / push alert evaluators |
| **Status** | FIXED |

## Symptom

Post-#4484 audit: `gex-alerts` and `vector-alerts` are registered `market_hours_only: true` but had
no `isEtCashRth()` execution gate. Both are inert today (push flags off), but once activated they
would poll heatmap/vector cache readers on weekday holidays.

## Root cause

Same ET-INTENT class as #4482–#4484: registry declares market-hours intent; route only had the
inert kill-switch, not a trading-calendar gate.

## Fix

Added `isEtCashRth()` gate after auth, before activation/work, returning the standard skip payload.

## Evidence

RED→GREEN static tests in each route's `route.test.ts`. All pass:
`npx tsx --test src/app/api/cron/gex-alerts/route.test.ts`
`npx tsx --test src/app/api/cron/vector-alerts/route.test.ts`
