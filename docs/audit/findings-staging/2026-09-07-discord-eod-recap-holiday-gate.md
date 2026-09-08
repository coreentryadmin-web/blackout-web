# HELIX/dark-pool Discord EOD recap fired on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-discord-eod-recap-holiday-gate |
| **Priority** | P2 |
| **Area** | Cron infra / Discord EOD recap |
| **Status** | FIXED |

## Symptom

Post-#4498 thermal EOD fix: `darkpool-discord` and `helix-discord-digest` still post session-close
recaps on NYSE holidays when `*_RTH_ONLY=0` — `isDiscordEodRecapWindow()` is time-only
(4:04–4:14 PM ET) with no `isTradingDayEt` check.

## Root cause

Same ET-INTENT class as thermal EOD pre-#4498: weekday schedule + time window without NYSE calendar.

## Fix

`discord-eod-recap.ts`: `isDiscordEodRecapWindow` now checks `isTradingDayEt(todayEt(now))` before
the 4:04–4:14 ET band check. Fixes both `darkpool-discord` and `helix-discord-digest` EOD paths.

## Blast radius

Shared helper only. Trading-day EOD recap behavior unchanged.

## Evidence

RED→GREEN: `src/lib/discord-eod-recap.test.ts` — new test
`isDiscordEodRecapWindow — false on NYSE holiday even in 4:04-4:14 ET band` asserts
`isDiscordEodRecapWindow(new Date("2026-09-07T20:06:00.000Z")) === false`.

`npx tsx --test src/lib/discord-eod-recap.test.ts` — pass. `npx tsc --noEmit` — clean.
