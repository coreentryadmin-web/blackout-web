# RTH deep audit false RED off-hours — FIXED

> **kind:** FINDING

## Symptom

`audit` workflow on `main@ebb16827` failed post-close (~6:12 PM ET): `full-site-deep-audit` P0 on SPX desk `price: 0`, and `gha-rth-audit` failed `cron-watchdog` on `swing-discovery` despite `rth_stale_keys: []`.

## Root cause

1. `auditSpxDesk()` required `price > 0` unconditionally — unlike deploy smoke (`evaluateSpxDeskSmoke`), which allows off-hours / `available:false`.
2. `gha-rth-audit` treated any `problem_keys` as a hard failure; ops-collect only pages P0 on `rth_stale_keys`.

## Fix

- Reuse `evaluateSpxDeskSmoke` for desk spot in `full-site-deep-audit.mjs`.
- Shared `evaluateCronWatchdogAudit()` for watchdog gating in full-site + `gha-rth-audit.mjs`.

| **Status** | FIXED (PR pending) |
