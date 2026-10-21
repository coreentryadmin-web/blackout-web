# zerodte-warm reserved heavy slot wedge after deploy kill

> **kind:** FINDING

## Summary

`cron-audit-query` failed on `main` with `problems: zerodte-warm` while `zerodte_scan_heartbeat` was `critical_stale`. Reserved heavy slot `cron:heavy-slot:reserved:zerodte-warm` could remain set after ECS recycled a task mid-run (no `slot.release()`), blocking subsequent warm passes even after overlap steal on `critical_stale`.

## Fix

- `forceReleaseReservedHeavyCronSlot()` deletes the reserved Redis key for allowlisted crons.
- `zerodte-warm` steal path (watchdog `critical_stale`) clears overlap lock, cooldown, and reserved slot.

## Status

| **Status** | FIXED in fix/zerodte-warm-reserved-slot-recovery (supersedes empty #6507 squash) |
