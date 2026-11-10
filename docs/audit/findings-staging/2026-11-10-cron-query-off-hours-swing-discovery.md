# Cron audit query false-red: swing-discovery off-hours

> **kind:** FINDING

| **Status** | FIXED |
| --- | --- |

## Symptom

`Cron audit query` failed run **42735522106** (`1f445e92`) at **Mon 8:25 PM ET** with only:

```text
problems: swing-discovery
```

## Root cause

Watchdog fallback treated all `problem_keys` as CI-fatal 24/7. `swing-discovery` is phase-anchored (not `market_hours_stale`) and routinely appears stale/failed between windows — `ops:collect` already pages that as P1, not P0.

## Fix

`cronAuditWatchdogProblemKeys()` — off `inRthOpenWindow`, fail CI only on `rth_stale_keys` (same as `gha-rth-audit` post-close runs).

## Evidence

`node --test scripts/lib/cron-audit-watchdog-keys.test.mjs`
