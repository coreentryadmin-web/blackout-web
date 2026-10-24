# zerodte-warm skipped on cooldown/overlap while scan heartbeat critical_stale

> **kind:** FINDING

## Summary

Cron audit `query` failed on `0301d512` (2026-10-22 RTH) with `problems: zerodte-warm` despite #6546 heavy-slot escalation. Steal NX only clears locks for one replica; others could still idempotent-skip on cooldown or wedged overlap while `zerodte_scan_heartbeat` stayed `critical_stale`.

## Fix

When `scanHeartbeat.critical_stale` during cash RTH: bypass cooldown skip (delete key and continue) and clear/retry overlap lock before skip.

## Status

| **Status** | FIXED in fix/zerodte-warm-bypass-guards-on-critical-stale |
