# gex-eod-snapshot wrote EOD anchors on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-gex-eod-snapshot-holiday-gate |
| **Priority** | P2 |
| **Area** | Cron infra / Thermal history_context |
| **Status** | FIXED |

## Symptom

Post-#4490/#4491 holiday-gate sweep: `gex-eod-snapshot` still snapshots 11 watchlist GEX
matrices on NYSE holidays when EventBridge fires at ~4:10 PM ET (e.g. Labor Day 2026-09-07).

## Root cause

No `isTradingDayEt()` check — route runs whenever authorized. Stale matrices get persisted
as session-close anchors, corrupting `history_context` day-over-day drift.

## Fix

Added `isTradingDayEt(sessionDay)` gate after auth; `force=1` bypasses for ops recovery.

## Blast radius

`gex-eod-snapshot` route only.

## Evidence

RED→GREEN static test: `npx tsx --test src/app/api/cron/gex-eod-snapshot/route.test.ts`
