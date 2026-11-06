# Cron audit query: spx-evaluate + spx-issues-sync false positives

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`Cron audit query` on `main` (2026-11-06): HTTP watchdog reported `problems: spx-evaluate, spx-issues-sync`.

## Root cause

`spx-evaluate` and `spx-issues-sync` routes gate work on `isSpxEngineCronWindow()` (7:00–16:15 ET weekdays, post-close tail). Cron health used the generic `market_hours_only` clock `isEtCashRth()` only. That is a **different** window than the routes, so `evaluateJob` / the spx-evaluate heartbeat path could flag **stale** while the real cron is legitimately idle per its own gate — or disagree on “in-window” vs off-window suppression.

## Fix

Treat `spx-evaluate` and `spx-issues-sync` as “off window” when `!isSpxEngineCronWindow(now)` (same as the routes). Thread explicit `now` into `effectiveStaleMinutes` in the spx-evaluate heartbeat block.

## Verify

`npx tsx --test src/lib/admin-cron-health.test.ts`
