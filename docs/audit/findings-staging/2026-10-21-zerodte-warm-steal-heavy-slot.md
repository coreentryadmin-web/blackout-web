# zerodte-warm wedge-breaker omitted reserved heavy-cron slot — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|

## Symptom

After #6494 reserved a dedicated heavy-cron slot for `zerodte-warm`, `cron-audit-query` could still fail during RTH if a prior run died mid-flight (deploy recycle): `cron:heavy-slot:reserved:zerodte-warm` stayed set for up to 900s while the existing steal path only cleared cooldown + overlap locks.

## Fix

On `critical_stale` steal, also `sharedCacheDel(heavyCronReservedSlotRedisKey("zerodte-warm"))`.

## Verify

Post-deploy: scan heartbeat recovers within one `zerodte-warm` cycle after a wedged reserved slot; `validate:cron` GREEN.
