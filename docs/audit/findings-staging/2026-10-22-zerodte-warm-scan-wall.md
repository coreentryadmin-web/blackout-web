# Cron audit RED — zerodte scan hung past heartbeat critical_stale

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`main@0301d512` **Cron audit query** failed afternoon RTH (`problems: zerodte-warm`); same SHA passed the morning run — intermittent prod stall.

## Root cause

`recordZeroDteScanTick` runs only after `scanZeroDteBoard()` returns. RVOL shadow timeouts (#6519) fixed one hang class; any remaining multi-minute stall (or overlap-blocked cycles) still lets `zerodte_scan_heartbeat` cross `critical_stale` (>10m) while cron handshakes look fine.

## Fix

Wrap the cron warm scan in `within(scanZeroDteBoard(), zerodteScanWallMs())` (default 9m). On wall breach: log, record heartbeat, skip persist for that cycle — scan may continue in background via `within()` semantics.

## Verify

`node --import tsx --test src/lib/zerodte/scan-wall.test.ts`; next RTH cron audit after deploy.
