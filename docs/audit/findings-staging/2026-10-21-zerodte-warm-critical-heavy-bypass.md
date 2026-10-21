# zerodte-warm: bypass heavy-cron cap when scan heartbeat is critical_stale

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## What broke

During RTH, `cron-audit-query` (HTTP watchdog fallback) failed with `problems: zerodte-warm` while `error_spike: none`. The 0DTE scan heartbeat (`zerodte_scan_heartbeat` / `recordZeroDteScanTick`) was **critical stale** (>10m), but `zerodte-warm` kept logging idempotent skips: `heavy-cron concurrency slot unavailable`.

The existing wedge breaker (#5213) clears overlap/cooldown locks on `critical_stale`, and #6494 reserved a dedicated heavy slot — but **pre-deploy** fleets still hit the shared-pool skip path, and even post-deploy a full shared pool must not block recovery when discovery is already dark.

## Fix

In `src/app/api/cron/zerodte-warm/route.ts`, when `scanHeartbeatCriticalStale && isEtCashRth()` and `acquireHeavyCronSlot` returns null, proceed with a no-op slot handle (log a warn) instead of skipping. Normal idempotent skip remains when the heartbeat is healthy.

## Verify after deploy

- `node scripts/cron-audit-query.mjs` → GREEN (no `zerodte-warm` in problems).
- Admin cron health: `zerodte-warm` not `market_hours_stale`; scan heartbeat age < 10m during RTH.
