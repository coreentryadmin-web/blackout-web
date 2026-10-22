# zerodte-warm wedge-breaker only cleared locks for steal winner — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## Symptom

`Cron audit query` failed on `main` 2026-10-22 RTH (`problems: zerodte-warm`) despite #6505/#6546 on main.

## Root cause

On `critical_stale`, only the `STEAL_ATTEMPT_KEY` NX winner deleted wedged cooldown/overlap/reserved heavy-slot keys. Other ECS replicas kept logging ok/skipped on cooldown or overlap while the scan heartbeat stayed critical.

## Fix

Always `sharedCacheDel` the three wedge keys on `critical_stale`; retry cooldown/overlap claims when still blocked.

## Verify

Post-deploy: `validate:cron` GREEN during RTH; scan heartbeat recovers within one warm cycle after a wedge.
