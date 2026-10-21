# 2026-10-21 — zerodte-warm steal must clear reserved heavy-cron slot

> **kind:** FINDING

| **Status** | FIXED (this PR) |
|------------|-----------------|

## Symptom

`cron-audit-query` on `main` failed RTH afternoon 2026-10-21 with `problems: zerodte-warm` (HTTP watchdog), after **#6494** reserved a dedicated heavy-cron slot.

## Root cause

When a `zerodte-warm` run dies mid-flight (deploy recycle), `cron:heavy-slot:reserved:zerodte-warm` can remain set for up to 900s. The existing `critical_stale` wedge-breaker only cleared `zerodte-warm:cooldown` and `zerodte-warm:running`, so new fires still failed `acquireHeavyCronSlot` while `zerodte_scan_heartbeat` stayed `critical_stale`.

## Fix

Export `heavyCronReservedSlotRedisKey()` and delete that key during the RTH steal path in `zerodte-warm/route.ts`.

## Verify at RTH

- `npm run validate:cron` GREEN on `main` after deploy.
- Admin cron-health: `zerodte-warm` not `market_hours_stale` during RTH; scan heartbeat age &lt; 10m.
