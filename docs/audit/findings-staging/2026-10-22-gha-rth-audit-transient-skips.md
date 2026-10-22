# GHA RTH deep audit false RED (Postgres ECONNRESET + socket-health 503)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **CI** | `audit` (RTH deep audit) on `main` @ `7b0f46b` |

## Symptom

`RTH deep audit` failed with `postgres: read ECONNRESET` and `socket-health: HTTP 503` while full-site deep audit reported 39 passes (1 P1 data note only).

## Fix

- `gha-rth-audit.mjs`: classify transient Postgres errors via `isTransientAuditPgError` / `describeConnectError` (skip, not fail).
- Route `socket-health` through `probeOptionsSocketWithRetries` (same as `rth-open-check`).

## Verify

Manual: re-run `RTH deep audit` workflow on `main` after merge.
