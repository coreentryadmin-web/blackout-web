# RTH open-check false RED on transient Postgres disconnect — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## Symptom

`RTH open check` failed on `main@ae00300` with `Postgres RTH checks: Connection terminated unexpectedly` while HTTP/socket probes were GREEN.

## Root cause

`isPrivateDbUnreachableError` did not classify mid-session RDS/proxy drops from GitHub Actions, so `rth-open-check.mjs` treated a CI connectivity blip as a production RTH failure.

## Fix

Classify `Connection terminated unexpectedly` as unreachable-from-audit-host (warn + skip), same as `ECONNRESET`.
