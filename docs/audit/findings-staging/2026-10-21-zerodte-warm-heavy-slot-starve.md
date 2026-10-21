# zerodte-warm starved by heavy-cron cap while scan heartbeat critical-stale

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`main@66691d75` **Cron audit query** failed: HTTP watchdog reported `problems: zerodte-warm` (listed twice: stale + `rth_stale_keys`). Docs-only commit; prod scanner path stalled during cash RTH.

## Root cause

`zerodte-warm` already breaks wedged cooldown/overlap locks when `zerodte_scan_heartbeat` is `critical_stale`, but a third gate — `acquireHeavyCronSlot` — still returned skip when two other heavy crons held the shared pool. Handshake logged ok/skipped while discovery ticks stopped advancing → watchdog + cron audit correctly red.

## Fix

On heavy-slot miss during cash RTH with `critical_stale` heartbeat, bypass the concurrency cap (noop release) and dispatch the warm anyway. Dedupe watchdog problem keys in `cron-audit-query.mjs` for clearer logs.

## Verify

After deploy: cron-staleness-watchdog should clear zerodte-warm within one scan cycle when stall was cap-only; re-run **Cron audit query** workflow.
