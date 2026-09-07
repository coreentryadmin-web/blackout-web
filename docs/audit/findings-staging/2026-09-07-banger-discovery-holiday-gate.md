# banger-discovery screened grouped-daily on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-banger-discovery-holiday-gate |
| **Priority** | P2 |
| **Area** | Cron infra / Polygon rate budget |
| **Status** | FIXED |

## Symptom

Post-#4490 swing-discovery holiday gate: `banger-discovery` still runs post-close grouped-daily
screening on NYSE holidays when EventBridge fires inside the 16:15 ET window (e.g. Labor Day
2026-09-07 at 21:15 UTC / 16:15 ET).

## Root cause

`inBangerDiscoveryWindow()` resolves the post-close ET band only — no `isTradingDayEt()` check.
Registry `weekdays_only: true` does not exclude NYSE holidays.

## Fix

Added `isTradingDayEt(sessionDate)` gate after auth and before the DST window guard; `force=1`
bypasses for ops recovery (same pattern as swing-discovery / nighthawk-morning-confirm).

## Blast radius

`banger-discovery` route only. Post-close window behavior on trading days unchanged.

## Evidence

RED→GREEN static test in `route.test.ts`:
`npx tsx --test src/app/api/cron/banger-discovery/route.test.ts`
