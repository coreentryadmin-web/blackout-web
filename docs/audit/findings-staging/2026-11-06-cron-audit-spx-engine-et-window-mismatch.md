# Cron audit query — spx-evaluate / spx-issues-sync false stale (engine window vs cash RTH)

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

Scheduled **Cron audit query** on `main` (`47392f2`, 2026-11-06 ~12:54 PM ET / 17:54 UTC) failed:

```
problems: spx-evaluate, spx-issues-sync
```

## Root cause

`spx-evaluate` and `spx-issues-sync` routes gate on **`isSpxEngineCronWindow`** (7:00–16:15 ET weekdays), but
`admin-cron-health.evaluateJob` treated `market_hours_only` as **cash RTH** via `isEtCashRth` (9:30–16:00 ET).

Between **4:00 and 4:15 PM ET** the engine is still in its evaluation/post-close tail; crons should run. Health
thought the market was “closed” and **suppressed** off-window staleness (`suppressStaleOffWindow`) for a last
`skipped`/`ok` row — so a >20m gap with no new `cron_job_runs` did **not** trip healthy and the watchdog listed both jobs stale.

Registry `schedule_cron_utc` for both jobs (TOML-aligned) was added so dual-band / idle-gap logic matches infra; the
**window mismatch** was the blocker.

## Fix

- `marketHoursActiveForCron`: `spx-evaluate` and `spx-issues-sync` use `isSpxEngineCronWindow(now)` instead of cash RTH.
- `buildCronHealthSnapshot` `spx-evaluate` heartbeat branch already used `isSpxEngineCronWindow`; left intact. Reverted an
  erroneous `zerodte-warm` `offWindow` edit to cash RTH.
- Tests: fixed instant Fri Nov 6 2026 4:05 PM / 4:20 PM ET fixtures.

## Verify

`node --import tsx --experimental-test-module-mocks --test src/lib/admin-cron-health.test.ts`
