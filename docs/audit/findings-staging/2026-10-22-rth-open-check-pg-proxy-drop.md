# RTH open-check RED on transient Postgres proxy drop — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## What broke

`open-check` on `main` (`ae00300c`, #6571) failed with `Postgres RTH checks: Connection terminated unexpectedly` after deploy validation passed. GHA connects via `DATABASE_PUBLIC_URL` (RDS Proxy public path); connect succeeded then the proxy dropped mid-query.

## Root cause

`scripts/rth-open-check.mjs` only skipped Postgres failures matching `isPrivateDbUnreachableError`, which did not include proxy mid-session `Connection terminated` errors. `validate-deploy` had the same gap for non-`ECONNRESET` transients.

## Fix

- Extend `isPrivateDbUnreachableError` in `scripts/pg-audit.mjs` for `connection terminated` / `connect failed`.
- Use `describeConnectError` + stale-auth skip in `rth-open-check.mjs` and `validate-deploy.mjs`.
- Replace `rg` with `grep -E` in uw-socket log probe (GHA runners lack `rg`).

## Verify

- `node --import tsx --test scripts/pg-audit.test.mjs`
- Next `open-check` run on `main` should stay GREEN when HTTP/socket probes pass and only Postgres flakes.
