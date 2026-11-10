# Cron audit query — off-hours swing-discovery false RED

> **kind:** FINDING

## Symptom

`main` CI `query` failed (`42735522106`, ~8:25 PM ET): HTTP watchdog fallback reported `problems: swing-discovery` and exited 1.

## Root cause

`gha-rth-audit` and `full-site-deep-audit` already gate on `evaluateCronWatchdogAudit()` (off-hours non-RTH problems do not fail). `cron-audit-query.mjs` still treated any `problem_keys` entry as fatal.

## Fix

Wire `auditViaWatchdog()` through `evaluateCronWatchdogAudit` + `inRthOpenWindow()`, same as other cron audits.

| **Status** | FIXED |
