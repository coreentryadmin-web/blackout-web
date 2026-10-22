# 2026-10-22 — zerodte-warm parallel double-scan delayed scan heartbeat

> **kind:** FINDING

| **Status** | FIXED (this PR) |
|------------|-----------------|

## Symptom

Scheduled `cron-audit-query` RED on `main` during RTH (`problems: zerodte-warm`, run 39808664306).

## Root cause

`zerodte-warm` dispatched `warmZeroDteBoard()` and `refreshZeroDteBoardSnapshot()` in parallel via `Promise.allSettled`. Each path runs a full `scanZeroDteBoard()`; only `warmZeroDteBoard` calls `recordZeroDteScanTick`. Under UW rate-limit contention the heartbeat did not advance until both scans finished (or the warm path stalled behind the parallel refresh), crossing `critical_stale` (>10m) while fast cron handshakes still logged ok/accepted.

## Fix

Serialize background work: `await warmZeroDteBoard()` then `await refreshZeroDteBoardSnapshot()` inside the existing `runWithBackgroundUwSweep` wrapper.

## Verify at RTH

`npm run validate:cron` GREEN; admin cron-health `zerodte-warm` not `market_hours_stale`; `zerodte_scan_heartbeat` age stays below 10m through the session.
