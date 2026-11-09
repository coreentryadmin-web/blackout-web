> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | RTH deep audit failed off-hours on SPX desk price=0 + cron-watchdog swing-discovery |
| **Status** | FIXED |

## What broke

`rth-deep-audit` job **audit** on `main@ebb16827` (~6:12 PM ET): `full-site-deep-audit` P0 `spx-desk` spot `0` after cash close; `gha-rth-audit` hard-failed `cron-watchdog` on non-`market_hours_stale` `swing-discovery`.

## Fix

- `auditSpxDesk` reuses `evaluateSpxDeskSmoke` (same RTH/off-hours contract as deploy smoke).
- `gha-rth-audit` cron-watchdog: fail on `rth_stale` always; on `problem_keys` only during cash RTH — warn off-hours.

## Verify

`npx tsx --test scripts/full-site-deep-audit.test.mjs`; next scheduled/off-hours `rth-deep-audit` run.
