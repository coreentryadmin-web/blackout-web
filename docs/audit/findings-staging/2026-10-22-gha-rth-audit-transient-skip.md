# GHA RTH deep audit RED on ECONNRESET + socket-health 503 — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## What broke

`RTH deep audit` (`audit` job) on `7b0f46b` failed with `postgres: read ECONNRESET` and `socket-health: HTTP 503` while full-site HTTP checks were otherwise green.

## Root cause

`scripts/gha-rth-audit.mjs` used a hand-rolled Postgres skip regex that omitted `ECONNRESET` (and other cases already covered by `isTransientAuditPgError` in `pg-audit.mjs`). Socket-health was a single fetch with no retry, unlike `rth-open-check.mjs` / `probeOptionsSocketWithRetries`.

## Fix

- Postgres catch: `describeConnectError` + `isTransientAuditPgError` / `isStaleAuditDbAuthError`.
- Socket-health: `probeOptionsSocketWithRetries` (3 attempts, same as open-check).

## Verify

- Next scheduled `RTH deep audit` on GHA after merge.
