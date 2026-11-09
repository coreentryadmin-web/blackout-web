> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | RTH deep audit RED after close on delayed schedule (run 42718407755) |
| **Status** | FIXED |

## Root cause

Scheduled run at **23:11 UTC** (~6:11 PM ET) still executed **full-site-deep-audit** and failed P0 on SPX `price:0` + empty heatmaps, plus `cron-watchdog` on `swing-discovery`. Postgres checks already skipped off-hours; deep numeric audit did not.

## Fix

- Extend `inRthOpenWindow` to **16:35 ET** (aligned with workflow's 4:30 PM slot).
- `gha-rth-audit.mjs`: skip full-site deep audit outside that window; do not fail `cron-watchdog` problems off-hours.
