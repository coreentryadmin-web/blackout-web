# Cron audit query false P0 — `failed` checked before off-schedule idle suppression

> **kind:** FINDING

| **Status** | FIXED |
|---|---|

**Symptom:** `Cron audit query` run `42649315653` @ `1cc122c0` (Mon 10:55 AM ET): problems
`spx-evaluate`, `nighthawk-outcomes`, `gex-eod-snapshot`, `banger-discovery`.

**Root cause:** Post-close weekday crons with `schedule_cron_utc` sit in
`isInOffScheduleIdleGap` all morning, but `evaluateJob` branched on `last.status === "failed"`
*before* `suppressStaleOffSchedule`, so Friday's prior-window failure paged every Monday until
the evening fire — even though the job is not due yet.

**Fix:** Run off-schedule suppression before the failed branch; include `failed` in the suppress
set (label notes prior-window failure). Regression test at `2026-11-09T15:55:00Z`.

**Note:** If `spx-evaluate` remains in `problem_keys` after deploy, that is an in-window staleness
signal (investigate prod `spx-evaluate` ticks), not this ordering bug.
