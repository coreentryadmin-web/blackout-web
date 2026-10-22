# zerodte-warm intermittent cron-audit failure — overlap retry + await heartbeat — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|

## Symptom

`Cron audit query` failed again on `0301d512` during RTH (`problems: zerodte-warm`) after passing earlier the same day — intermittent `zerodte_scan_heartbeat` critical_stale.

## Fix

1. When heartbeat is `critical_stale`, retry overlap-lock claim after `sharedCacheDel(OVERLAP_LOCK_KEY)` (steal can race with a stale holder).
2. `await recordZeroDteScanTick("cron")` in `warmZeroDteBoard` so the tick is persisted before the cron body returns (was fire-and-forget `void`).

## Verify

`validate:cron` GREEN across RTH; admin scan heartbeat age stays under critical threshold.
