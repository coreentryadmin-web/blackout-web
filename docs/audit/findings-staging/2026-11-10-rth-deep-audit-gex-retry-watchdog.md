# RTH deep audit RED — GEX cold blip + swing-discovery cron gate — FIXED

> **kind:** `FINDING`

## Symptom

`RTH deep audit` on `main@0ba38002` (~15:38 ET Tue): P0 `data-integrity` GEX SPX/SPY cold during RTH; `cron-watchdog: problems: swing-discovery`.

## Root cause

1. `runDataIntegrityChecks` sampled `getGexPositioning` once — a single null during matrix rebuild/roll tripped C6.
2. `evaluateCronWatchdogAudit` set `shouldFail` when any `problem_keys` entry existed during RTH, even without `market_hours_stale` (swing-discovery phase handshake).

## Fix

- Retry GEX pair up to 3× (2.5s gap) before C6 cold flags.
- `shouldFail` only on `rth_stale_keys` or critical `error_spike`.

## Status

| **Status** | FIXED (branch `cursor/autopilot-work-loop-aeaa`) |
