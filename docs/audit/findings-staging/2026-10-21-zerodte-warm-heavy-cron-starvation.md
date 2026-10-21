# zerodte-warm scan heartbeat critical_stale under heavy-cron pool exhaustion — FIXED

> **kind:** FINDING

| **Status** | FIXED (reserved heavy-cron slot) |
|------------|----------------------------------|

## Symptom

`Cron audit query` on `main` @ `66691d75f` failed: HTTP watchdog reported `problems: zerodte-warm, zerodte-warm` during RTH (~11:55 ET). Production `zerodte_scan_heartbeat` was `critical_stale` (>10m since `recordZeroDteScanTick`) while `cron_job_runs` for `zerodte-warm` still logged ok/skipped every few minutes.

## Root cause

`zerodte-warm` competed for the shared 2-slot `acquireHeavyCronSlot` pool with vector-family crons that routinely hold slots for many minutes. Repeated `heavy-cron concurrency slot unavailable (idempotent skip)` responses meant the background `warmZeroDteBoard()` chain never ran, so the scan heartbeat never advanced.

## Fix

Add `zerodte-warm` to `RESERVED_SLOT_CRONS` (same pattern as `swing-active-refresh`, 2026-10-14). Deduplicate watchdog problem keys in `scripts/cron-audit-query.mjs` so RTH-stale jobs are not double-counted in CI logs.

## Verify after deploy

- `npm run validate:cron` GREEN during RTH
- Admin cron health: `zerodte-warm` status not stale; `zerodte_scan_heartbeat` age < 10m
- CloudWatch: `[cron/zerodte-warm] background done` resumes ~every 2–5m during RTH
