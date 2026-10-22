# RTH open-check RED — transient Postgres drop from GHA

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`main@ae00300c5` **open-check** failed: `Postgres RTH checks: Connection terminated unexpectedly` (14:09 ET RTH).

## Root cause

`rth-open-check.mjs` used a single connect/query pass with no retry. GHA → public RDS can drop mid-session; validate-deploy already treats connect `ECONNRESET` as skippable, but RTH section failed hard on the first disconnect.

## Fix

`withAuditPgClient()` in `pg-audit.mjs` (3 attempts, transient classifier includes "Connection terminated unexpectedly"). RTH checks run inside it; uw-socket railway log probe skipped up-front in GITHUB_ACTIONS (no `rg` on runner).

## Verify

`node --test scripts/pg-audit.test.mjs`; next `rth-open-check.yml` on `main`.
