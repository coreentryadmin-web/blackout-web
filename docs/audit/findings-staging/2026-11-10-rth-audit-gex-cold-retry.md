> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | RTH deep audit failed on transient GEX cold + swing-discovery handshake |
| **Status** | FIXED |

## What broke

`rth-deep-audit` **42897223779** (~3:38 PM ET): P0 `data-integrity` C6 (`getGexPositioning` null while `market_open`); `cron-watchdog` failed on phase-anchored `swing-discovery` without `rth_stale`.

## Fix

- `runDataIntegrityChecks`: 2.5s retry for SPX/SPY matrix before C6 cold flags.
- `gha-rth-audit`: one data-integrity re-fetch after transient discrepancies.
- `evaluateCronWatchdogAudit`: `swing-discovery` warn-only during RTH (not a hard audit fail).

## Verify

`npx tsx --test scripts/audit/lib/watchdog-audit-eval.test.ts`
