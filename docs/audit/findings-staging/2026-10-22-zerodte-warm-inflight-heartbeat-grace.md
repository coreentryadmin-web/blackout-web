# zerodte-warm heartbeat false RTH stale while overlap lock held

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — cron audit CI / watchdog noise |
| **Discovered** | 2026-10-22 Cron audit query run 39808664306 |

## Symptom

Scheduled `Cron audit query` failed: `problems: zerodte-warm` during RTH (recurring ~11:50 ET pattern).

## Root cause

`recordZeroDteScanTick` runs only after `scanZeroDteBoard()` returns. Multi-minute scans under RTH load can exceed the heartbeat's **10m `critical_stale`** threshold while `zerodte-warm:running` overlap lock is still held — watchdog treats that as discovery stalled even though work is in flight.

## Fix

`buildCronHealthSnapshot`: when overlap lock is present and heartbeat age &lt; 18m, downgrade to `warning` with `market_hours_stale: false` instead of RTH stale.

## Evidence

Run 39808664306 at 15:51 UTC; prior day same class after slot-starvation fix (#6494).
