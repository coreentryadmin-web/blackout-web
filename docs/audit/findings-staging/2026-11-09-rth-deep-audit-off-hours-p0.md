> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | RTH deep audit RED post-close on desk spot 0 + swing-discovery watchdog |
| **Status** | FIXED |

## What broke

`RTH deep audit` run **42718407755** (Mon 2026-11-09 23:12 UTC / 6:12 PM ET): P0 `[spx-desk] SPOT: 0` with `available:false`, plus cron-watchdog failed on off-hours `swing-discovery` problem (not RTH-stale).

## Fix

`full-site-deep-audit`: shared `spxDeskSpotSeverity` skips P0 when desk honestly unavailable or outside cash RTH. `gha-rth-audit`: cron-watchdog fails only on `rth_stale_keys` / in-session problems.

## Verify

`npx tsx --test scripts/lib/full-site-spx-desk-eval.test.ts`; next scheduled RTH deep audit.
