# RTH deep audit — swing-discovery intraday suppress + Polygon circuit GEX skip

> **kind:** FINDING

## Summary

Scheduled **RTH deep audit** failed at Tue **15:38 ET** (`42897223779`): `swing-discovery` in cron watchdog `problem_keys`, `data-integrity` GEX cold P0s, and matching full-site integrity failures. Sentry showed Polygon circuit open (rate-limit pause).

## Root cause

1. **swing-discovery:** `swingDiscoveryAwaitingPhaseSuppress` required POST_CLOSE satisfaction before suppressing handshake stale/failed. During **POWER_HOUR** (before POST_CLOSE), misleading aged handshakes stayed `failed`/`stale` and failed RTH watchdog + P1 cron audit.
2. **data-integrity:** `getGexPositioning` null during RTH was always a discrepancy; during **Polygon circuit open** that is an expected brief cold window, not a warmer outage.

## Fix

- Suppress swing-discovery health noise in **PRE_OPEN / MIDDAY / POWER_HOUR** while the active phase claim is not `done`.
- Skip GEX cold cross-checks when `isPolygonCircuitOpen()` is true.

## Verification

- `npx tsx --test src/lib/swing/discovery-cron-health.test.ts` (POWER_HOUR repro case)

| **Status** | FIXED in PR |
