# X automation future tweet timestamps bypass spacing / age filters

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-x-timestamp-guards |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | `x-engage-engine.ts`, `x-api.ts`, `x-post-guard.ts` |

## Symptom

Clock-skewed future `created_at` on tweets produced negative ages. Engage engine treated them as fresh; post guard false-blocked with negative minute spacing.

## Root cause

Raw `Date.now() - new Date(iso)` without `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` guard (pattern used elsewhere via `timestamp-freshness.ts`).

## Fix

Added `minutesSinceIso` / `ageHoursFromIso` helpers; wired X automation paths to shared guards.

## Evidence

`src/lib/ws/timestamp-freshness-x-guards.test.ts`

## Market-open check

N/A — cron-only social automation; verify via unit tests.
