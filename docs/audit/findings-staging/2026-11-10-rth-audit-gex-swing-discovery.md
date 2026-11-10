# RTH audit RED — swing-discovery during POWER_HOUR + transient GEX cold — FIXED

> **kind:** FINDING

## Symptom

`RTH deep audit` on `main@0ba38002` (Tue 15:38 ET): P0 `data-integrity` GEX SPX/SPY cold; `cron-watchdog` `swing-discovery` during cash RTH.

## Root cause

1. `swingDiscoveryAwaitingPhaseSuppress` required same-day POST_CLOSE before any intraday suppress — blocked POWER_HOUR at 3:38 PM.
2. `data-integrity` single-shot `getGexPositioning` could read cold during brief Polygon circuit-open blips (Sentry: rate-limit pause) while heatmap cache was warm on retry.

## Fix

- OVERNIGHT-only POST_CLOSE prerequisite; intraday phases suppress while active phase scan pending.
- `getGexPositioningWithRthRetry` (3× / 2.5s) in `runDataIntegrityChecks`.

| **Status** | FIXED (PR pending) |
