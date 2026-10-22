# cron-audit query RED — swing-discovery phase cadence vs generic staleness

> **kind:** FINDING

## Summary

`query` failed on `e5492650` / `4809d6fb5` with `problems: swing-discovery` during RTH. Phase-anchored discovery intentionally skips between ET windows and can fail a single phase with `claim_released` while EventBridge retries; generic `evaluateJob` stale/failed tripped the watchdog.

## Fix

`applySwingDiscoveryCronHealth()` — phase-claim + serving-snapshot aware overrides in `buildCronHealthSnapshot()`.

## Status

| **Status** | FIXED in fix/swing-discovery-phase-cron-health |
