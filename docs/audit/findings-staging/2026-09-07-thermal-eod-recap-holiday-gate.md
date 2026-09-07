# thermal-discord EOD recap fired on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-thermal-eod-recap-holiday-gate |
| **Priority** | P2 |
| **Area** | Cron infra / Thermal Discord digest |
| **Status** | FIXED |

## Symptom

Post-#4490–#4492 holiday-gate sweep: `thermal-discord` EOD recap still had a real side effect on
Labor Day 2026-09-07 — `isThermalEodRecapDue` is time-only (16:00–16:30 ET) with no
`isTradingDayEt` check, so `eodDue=true` bypasses the RTH skip and posts a session-close Discord
recap on a closed market.

(This finding originally also bundled a `largo-morning-brief` fix. That route is dropped from
this PR entirely — #4499 shipped the `largo-morning-brief` holiday gate independently, ordered
before `inMorningWindow()` to match the established pattern in `nighthawk-morning-confirm`/
#4490-#4494, avoiding a scope overlap and gate-ordering inconsistency flagged by Cursor on this
PR. See #4499 for that fix's evidence.)

## Root cause

Same ET-INTENT class as other holiday gaps: weekday EventBridge schedule + time window without
NYSE calendar awareness.

## Fix

`thermal-discord-eod.ts`: `isThermalEodRecapDue` now checks `isTradingDayEt(todayEt(now))` before
the 16:00–16:30 ET band check, returning `false` on a NYSE holiday even inside that band.

## Blast radius

One route only (`isThermalEodRecapDue` in `src/lib/thermal-discord-eod.ts`). Trading-day EOD
recap behavior unchanged.

## Evidence

RED→GREEN: `src/lib/thermal-discord-breach-state.test.ts` — new test
`isThermalEodRecapDue — false on NYSE holiday even in 4:00-4:30 ET band` asserts
`isThermalEodRecapDue(new Date("2026-09-07T20:10:00.000Z")) === false`. Fails against pre-fix
code (time-only check returns `true` inside the band regardless of calendar), passes post-fix.

`node --import tsx --experimental-test-module-mocks --test src/lib/thermal-discord-breach-state.test.ts`
— pass. `npx tsc --noEmit` — clean.
