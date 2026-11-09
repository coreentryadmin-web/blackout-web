# Post-close crons: prior-session `failed` pages query CI every weekday morning

> **kind:** `FINDING`

## Symptom

Scheduled **Cron audit query** on `main@1cc122c06` reported `problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery` (~10:55 AM ET Mon 2026-11-09).

Three post-close jobs had **Friday failed handshakes** while Monday was still before the first UTC fire (`20:10` / `20:15` / `20:30`).

## Root cause

`evaluateJob` treated `last.status === "failed"` unconditionally. Off-schedule **stale** suppression did not apply to **failed** rows, so Friday failures stayed red until the next evening fire — a false P0 in `cron-audit-query`.

## Fix

`isPriorSessionCronFailureSuppressed()` in `cron-schedule-window.ts`: when `now` is before today's first scheduled fire and the last failed run started before that fire → report **healthy** idle (prior failure, awaiting today's retry).

## Status

**FIXED** on branch `fix/cron-health-prior-session-failed`.

**Note:** Underlying Friday failures may still need ops follow-up; this change only stops the morning watchdog false positive.
