# RTH deep audit — off-hours SPX desk spot false P0

> **kind:** FINDING

## Symptom

`main` CI `audit` (RTH deep audit run `42718407755`, ~6:11 PM ET Mon) failed on:

- **P0** `full-site-deep-audit`: `[spx-desk] SPOT: spot missing or invalid: 0`
- **cron-watchdog**: `swing-discovery` in `problem_keys` (non-RTH phase cron)

## Root cause

1. `auditSpxDesk()` required `price > 0` unconditionally. After the cash close the desk honestly serves `price: 0` while `prior_close` remains valid — same convention as `spx-oracle-eval.mjs` / data-validator.
2. `gha-rth-audit.mjs` treated any `cron-staleness-watchdog` `problems > 0` as a hard fail, including post-close phase jobs like `swing-discovery` that are not in `rth_stale_keys`.

## Fix

- `scripts/full-site-deep-audit.mjs`: off-RTH spot check uses `inRthOpenWindow()`, `market_open`, `prior_close`, or `available: false`.
- Platform snapshot: skip live SPX requirement off-RTH.
- `scripts/gha-rth-audit.mjs`: cron-watchdog gate fails only on `rth_stale_keys` or `error_spike === critical`.

| **Status** | FIXED |
