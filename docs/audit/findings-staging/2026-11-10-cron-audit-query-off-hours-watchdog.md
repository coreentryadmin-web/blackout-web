# Cron audit query RED on post-close swing-discovery — FIXED

> **kind:** FINDING

## Symptom

`Cron audit query` on `main@1f445e92` failed HTTP watchdog fallback: `problems: swing-discovery` while cash RTH was closed.

## Root cause

`auditViaWatchdog()` unioned `problem_keys` + `rth_stale_keys` and exited 1 on any entry. Post-close schedule staleness is not an RTH outage (sibling audits were fixed in #7864).

## Fix

Wire `evaluateCronWatchdogAudit()` + `inRthOpenWindow()` into `scripts/cron-audit-query.mjs`; log `off_hours_ignored` for visibility.

| **Status** | FIXED (PR pending) |
