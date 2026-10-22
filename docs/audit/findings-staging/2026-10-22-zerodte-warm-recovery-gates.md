# zerodte-warm: recovery bypass for cooldown/overlap when scan heartbeat critical_stale

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## What broke

`cron-audit-query` failed on `main` (2026-10-22 ~11:50 ET) with `problems: zerodte-warm` despite #6494 reserved heavy slot and #6546 heavy-pool escalation. Wedged-lock steal only runs on one replica per 30s; other fires still hit the 60s rerun cooldown or overlap skip while `zerodte_scan_heartbeat` stayed critical_stale.

## Fix

When `recoveryBypass` (cash RTH + `critical_stale`): skip cooldown floor, retry overlap after forced clear, and dispatch **scanner-only** `warmZeroDteBoard()` (defer `refreshZeroDteBoardSnapshot` until the next healthy tick).

## Verify after deploy

- Scheduled `Cron audit query` GREEN on `main`.
- Admin cron health: zerodte-warm scan heartbeat age < 10m during RTH.
