# validate:deploy false-fails options-socket on NYSE holidays — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P3 |
| **Area** | ops / validate:deploy |
| **PR** | fix/validate-deploy-holiday-socket-probe |

## Symptom

On NYSE weekday holidays (Labor Day 2026-09-07) after 09:30 ET, `npm run validate:deploy` hard-failed with `options-socket (socket-health): probe HTTP 200` even though options socket standdown on holidays is expected.

## Root cause

`runSocketHealthProbe` used `afterOpen930 = etMinutesNow() >= 9*60+30` without `isTradingDayEt`. Holidays read as post-open RTH → probe retries exhaust → hard fail.

## Fix

Gate RTH socket strictness on `isTradingDayEt(todayEtYmd(now))`, matching `rth-open-check.mjs` writer freshness skips. Emit explicit holiday warn.

## Evidence

- Pre-fix: validate:deploy FAILED on 2026-09-07 Labor Day
- Post-fix: validate:deploy GREEN with holiday warn
