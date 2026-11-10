# swing-discovery query CI — prior-phase failed grace

> **kind:** FINDING

## Summary

Scheduled `cron-audit-query` (HTTP watchdog fallback) failed on `main` with `problem_keys: swing-discovery` at ~8:25 PM ET Monday. The last `cron_job_runs` handshake was a **POST_CLOSE** phase failure, while the clock had already entered the **OVERNIGHT** phase window where EventBridge continues to fire every 30m for a retry.

## Root cause

`swing-discovery` is phase-anchored and has **no** `schedule_cron_utc` in the registry, so `evaluateJob` could not apply the existing off-schedule idle-gap suppression used by post-close UTC-scheduled crons. A prior-phase `failed` remained `failed` through the next phase's retry window, tripping the watchdog and failing CI until OVERNIGHT succeeded or also failed.

## Fix

`swingDiscoveryPriorPhaseFailureInGrace()` in `discovery-cron-health.ts`: when the ET clock is inside an active phase and the last failure timestamp predates that phase's start, `evaluateJob` downgrades to **warning** (not watchdog `problem_keys`).

## Verification

- `npx tsx --test src/lib/swing/discovery-cron-health.test.ts src/lib/admin-cron-health.test.ts`

| **Status** | FIXED in PR |
