# legacy-live-sync still polled Polygon on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-cron-holiday-gate-legacy-live-sync |
| **Priority** | P3 |
| **Area** | Cron infra / Polygon rate budget |
| **Status** | FIXED |

## Symptom

Post-#4484 audit of remaining `market_hours_only: true` crons. On Labor Day 2026-09-07,
`legacy-live-sync` still executed Polygon option marks + stock snapshots + DB state updates
on EventBridge's weekday schedule when `LEGACY_DISCORD_ALERTS` is enabled.

## Root cause

Same ET-INTENT class as `banger-live-sync` (#4484): registry declares `market_hours_only: true`
but the route had no `isEtCashRth()` execution gate.

## Fix

Added holiday-aware RTH gate after auth, returning
`{ ok: true, skipped: true, reason: "outside RTH (weekend/holiday/off-hours)" }`.

## Blast radius

One route only. RTH behavior unchanged.

## Evidence

RED→GREEN static test in `route.test.ts`:
`npx tsx --test src/app/api/cron/legacy-live-sync/route.test.ts`
