# Cron audit query: `swing-discovery` false P0 after POST_CLOSE satisfied

> **kind:** `FINDING`

## Symptom

`Cron audit query` on `main@1f445e92` (2026-11-10T01:25Z / 8:25 PM ET) reported sole problem `swing-discovery` via HTTP watchdog.

## Root cause

1. Handshake-only health could stay `failed` when the **primary POST_CLOSE** scan succeeded (serving snapshot + claim) but a later **OVERNIGHT** EventBridge fire logged `ok:false` (Polygon 429).
2. `buildDiscoveryDeps` fetched **grouped-daily twice** per scan (STRUCTURE + intraday refresh), doubling 429 pressure on a single POST_CLOSE run.

## Fix

- Eager serving-snapshot probe + POST_CLOSE claim artifact override in `buildCronHealthSnapshot`.
- `loadGroupedDaily` memoization + 429 backoff in swing-discovery route.

## Status

**FIXED** on `fix/query-swing-discovery`.
