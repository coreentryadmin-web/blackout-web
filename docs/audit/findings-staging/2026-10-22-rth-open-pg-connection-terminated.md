# RTH open-check: treat "Connection terminated unexpectedly" as unreachable from GHA

> **kind:** FINDING

| **Status** | FIXED (pending merge) |
|------------|------------------------|

## Symptom

`open-check` on `main` (`ae00300c5`) failed: deploy validation GREEN, RTH section `Postgres RTH checks: Connection terminated unexpectedly` while `validate-deploy` already warned `read ECONNRESET` and skipped DB.

## Root cause

`isPrivateDbUnreachableError()` in `pg-audit.mjs` did not classify RDS proxy connection drops after connect (`Connection terminated unexpectedly`), so `rth-open-check.mjs` failed CI instead of skipping like other GHA-unreachable Postgres errors.

## Fix

Extend classifier with `connection terminated` (aligned with `src/lib/db-transient.ts`).
