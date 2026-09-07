# largo-morning-brief + thermal EOD recap fired on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-thermal-holiday-gates |
| **Priority** | P2 |
| **Area** | Cron infra / member push + Discord |
| **Status** | FIXED |

## Symptom

Post-#4490–#4492 holiday-gate sweep: two routes still had real side effects on Labor Day
2026-09-07:

- `largo-morning-brief` — dual-band EventBridge (13:25/14:25 UTC) lands **9:25 AM ET** on
  NYSE holidays; `inEtWindow` alone does not exclude holidays → web-push to opted-in members
  with a fake "open" brief.
- `thermal-discord` EOD recap — `isThermalEodRecapDue` is time-only (16:00–16:30 ET) with no
  `isTradingDayEt` check; `eodDue=true` bypasses the RTH skip → session-close Discord recap on
  a closed market.

## Root cause

Same ET-INTENT class as other holiday gaps: weekday EventBridge schedule + time window without
NYSE calendar.

## Fix

- `largo-morning-brief`: `isTradingDayEt(sessionDay)` after `inMorningWindow`, before
  `buildLargoMorningBrief`; `force=1` bypasses (same pattern as `nighthawk-morning-confirm`).
- `thermal-discord-eod`: `isTradingDayEt(todayEt(now))` inside `isThermalEodRecapDue` before
  the 16:00–16:30 ET band check.

## Blast radius

Two routes only. Trading-day morning brief + EOD recap behavior unchanged.

## Evidence

RED→GREEN static tests:
`npx tsx --test src/app/api/cron/largo-morning-brief/route.holiday-gate.test.ts`
`npx tsx --test src/lib/thermal-discord-breach-state.test.ts`
