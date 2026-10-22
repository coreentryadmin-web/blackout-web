# GHA RTH deep audit — transient Postgres + socket-health blips

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## What broke

`RTH deep audit` on `main@7b0f46b` failed with:

- `postgres: read ECONNRESET` — GHA runner TCP reset to `DATABASE_PUBLIC_URL` proxy
- `socket-health: HTTP 503` — single-shot probe during marks warming (no retry)

`rth-open-check` already skipped unreachable Postgres and retried socket-health via `probeOptionsSocketWithRetries`; `gha-rth-audit.mjs` did not.

## Fix

- Postgres catch: `describeConnectError` + `isPrivateDbUnreachableError` / `isStaleAuditDbAuthError` (skip, not RED)
- Cron socket probe: same retry helper as `rth-open-check.mjs`

## Validate

Re-run `RTH deep audit` workflow on merge; off-hours can run `node scripts/gha-rth-audit.mjs` only with secrets locally.
