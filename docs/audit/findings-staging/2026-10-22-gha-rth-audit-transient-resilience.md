# RTH deep audit RED — transient socket-health 503 + Postgres ECONNRESET

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`main@7b0f46b01` scheduled **RTH deep audit** failed: `socket-health: HTTP 503` and `postgres: read ECONNRESET` (deploy smoke passed).

## Root cause

`gha-rth-audit.mjs` lacked the retry/skip discipline already shipped in `rth-open-check.mjs` (`isTransientAuditPgError`, socket probe retries). Full-site audit also P1-flagged caveated Night Hawk premiums (`premium_cap_ok === false`).

## Fix

Align GHA audit Postgres checks with RTH-open retry + transient skip; route socket-health through `probeOptionsSocketWithRetries`; retry other cron HTTP routes on 502/503/524. Deep audit skips premium-cap P1 when `premium_cap_ok === false`.

## Verify

Next `rth-deep-audit.yml` run on `main`; `node --test scripts/pg-audit.test.mjs`.
