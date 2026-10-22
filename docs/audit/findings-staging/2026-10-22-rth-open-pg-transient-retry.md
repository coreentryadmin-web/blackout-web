# RTH open check flaky on Postgres "Connection terminated unexpectedly"

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — GHA `RTH open check` false RED |
| **Discovered** | 2026-10-22 workflow run 39828835843 on `main` `ae00300` |

## Symptom

`open-check` failed: `Postgres RTH checks: Connection terminated unexpectedly` while deploy validation and socket-health were GREEN.

## Root cause

`rth-open-check.mjs` used a single Postgres session with no retry. Mid-query RDS/proxy drops from GitHub Actions are transient but were not classified (unlike `ECONNRESET` on connect).

## Fix

- `isTransientPostgresAuditError()` in `pg-audit.mjs` for abrupt termination strings.
- RTH Postgres block retries up to 3 times with 2s backoff before failing.

## Evidence

Run 39828835843 at 18:10 UTC; failure unrelated to `ae00300` cron-health merge.
