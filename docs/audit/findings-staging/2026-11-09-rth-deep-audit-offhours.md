# RTH deep audit RED off-hours (spx-desk P0 + swing-discovery watchdog)

> **kind:** `FINDING`

## Symptom

`RTH deep audit` job `audit` failed on `main@ebb16827` (2026-11-09 ~6:12 PM ET): full-site P0 `[spx-desk] spot missing or invalid: 0` and `cron-watchdog: swing-discovery`.

## Root cause

1. **full-site-deep-audit.mjs** always P0'd `price <= 0` on `/api/market/spx/desk` even when deploy smoke already treats `available:false` / off-hours as warn (`evaluateSpxDeskSmoke`).
2. **admin-cron-health** used registry `stale_after_min: 36h` for `swing-discovery` while phase-anchored discovery can legitimately gap Fri post-close → Mon POST_CLOSE (`swingDiscoveryHandshakeStaleMin()` ~60h+).

## Fix

- Desk audit delegates spot gate to `evaluateSpxDeskSmoke` (early return on warn).
- `effectiveStaleMinutes` for `swing-discovery` uses `swingDiscoveryHandshakeStaleMin()`.

## Status

**FIXED** on `fix/rth-audit-offhours-desk-swing`.
