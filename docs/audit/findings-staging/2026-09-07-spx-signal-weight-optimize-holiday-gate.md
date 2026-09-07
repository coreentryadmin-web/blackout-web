# spx-signal-weight-optimize missing NYSE holiday gate — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (PR pending) |
| **Priority** | P1 |
| **Area** | cron / SPX signal optimizer |
| **Discovered** | 2026-09-07 (Labor Day holiday-gate sweep) |

## Symptom

`spx-signal-weight-optimize` runs Mon–Fri at 22:00 UTC (~6 PM ET post-close) with no `isTradingDayEt()` guard. On NYSE holidays (e.g. Labor Day 2026-09-07) it still queries `spx_signal_observations` and writes a ranked report to `spx_signal_weight_reports` against a closed tape.

## Root cause

Holiday-gate sweep (#4490–#4498) covered member-facing push/Discord routes but missed this post-close analytics writer. The route only had auth + `requireDatabaseInProduction()` before DB work.

## Fix

- `isTradingDayEt(sessionDay)` after auth, before `initSpxSignalTables()` / any `dbQuery`
- `force=1` bypass for ops recovery (matches `nighthawk-outcomes`, `zerodte-grade`)
- Static source-order test + mocked integration tests in `route.test.ts`

## Evidence

- `node --import tsx --experimental-test-module-mocks --test src/app/api/cron/spx-signal-weight-optimize/route.test.ts src/app/api/cron/spx-signal-weight-optimize/route.holiday-gate.test.ts` — GREEN
- `npx tsc --noEmit` — clean

## Blast radius

`spx-signal-weight-optimize` route only. Trading-day post-close optimizer behavior unchanged.
