# zerodte-warm wedged overlap lock during RTH — FIXED

> **kind:** FINDING

| **Status** | FIXED in `fix/zerodte-warm-stale-lock-steal` |
|------------|-----------------------------------------------|

## Symptom

`ops:collect` P0 `watchdog:rth-stale:zerodte-warm` on 2026-09-18 ~17:10 UTC. Admin cron-health:
`Scanner stale · last scan tick 47m ago` while `cron_job_runs` showed hundreds of `skipped`
(`rate-limited` / `previous warm still in flight`).

## Root cause

Overlap lock + 60s cooldown prevented new `warmZeroDteBoard()` dispatches while a prior background
chain never completed (or lock outlived the worker). Handshake paths kept logging `ok/skipped`, so
`cron_job_runs` looked healthy but `zerodte_scan_heartbeat` (`recordZeroDteScanTick`) stalled.

## Fix

When `loadZeroDteScanHeartbeat()` reports `critical_stale` during options market hours:
- bypass the rerun cooldown floor, and
- delete + re-acquire `zerodte-warm:running` once before idempotent skip.

## Evidence

Live admin `/api/admin/cron-health` zerodte-warm meta: `critical_stale: true`, age ~47m, last_status skipped.
