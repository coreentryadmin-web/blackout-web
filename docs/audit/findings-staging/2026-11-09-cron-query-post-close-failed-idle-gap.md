# Cron audit `query` — false P0 on post-close jobs Monday RTH

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## Symptom

`Cron audit query` on `main` @ `1cc122c06` (2026-11-09 15:55 UTC / 10:55 ET Monday) reported:

`problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery`

## Root cause

`evaluateJob()` suppressed **stale** post-close jobs during `isInOffScheduleIdleGap()` (Friday → Monday idle) when the last run was `ok`/`skipped`, but still surfaced **`failed`** for the same window. Weekend suppression (`nonTradingScheduledIdle`) already cleared both stale and failed on non-trading days; **trading-day** idle gaps did not — so Friday failed handshakes for `nighthawk-outcomes`, `gex-eod-snapshot`, and `banger-discovery` tripped `cron-staleness-watchdog` → `cron-audit-query` during Monday RTH before their evening fire (ops #1983 intent, incomplete branch).

## Fix

When `schedule_cron_utc` + off-schedule idle gap (or awaiting dual UTC band), treat `last.status === "failed"` like stale suppression → `healthy` with idle label.

## Blast radius

`cron-audit-query`, admin cron health board, Discord watchdog alerts — only jobs with `schedule_cron_utc` in long idle gaps.

## Not fixed here

`spx-evaluate` in the same CI run is likely a **real** in-window stale/failed (engine/cron handshake); needs prod `cron_job_runs` + play-engine heartbeat verification after this deploy.

## Verify

- Unit: new test in `admin-cron-health.test.ts` (Monday 10:55 ET, Friday failed last run → healthy).
- Post-merge: `query` CI green; RTH Mon re-check watchdog if `spx-evaluate` still alarms.
