# zerodte-warm starved by heavy-cron shared pool → RTH scan heartbeat stale

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P1 — 0DTE discovery / cron audit CI |
| **Discovered** | 2026-10-21 Cron audit query run 39629958987 |

## Symptom

Scheduled `Cron audit query` failed on `main` with `problems: zerodte-warm, zerodte-warm` (duplicate keys from `problem_keys` + `rth_stale_keys`).

## Root cause

During RTH, `zerodte-warm` could not acquire a **shared** heavy-cron slot while two vector-family crons held both slots for multi-minute runs. The route logged `skipped: heavy-cron concurrency slot unavailable` while the fast `cron_job_runs` handshake still looked fresh; `admin-cron-health` correctly elevated **`zerodte_scan_heartbeat` `critical_stale`** (>10m without scan tick) to `market_hours_stale`.

## Fix

Reserve a dedicated heavy-cron slot for `zerodte-warm` (same pattern as `swing-active-refresh`). Dedupe watchdog problem keys in `cron-audit-query.mjs` for clearer logs.

## Evidence

GH Actions `39629958987` at 15:55 UTC; prior day intermittent failures at 15:37 and 16:44 UTC on `main`.
