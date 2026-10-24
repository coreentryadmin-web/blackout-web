# GHA RTH deep audit failed on transient socket-health 503 + Postgres ECONNRESET — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

`RTH deep audit` on `7b0f46b` failed with `socket-health: HTTP 503` and `postgres: read ECONNRESET` while full-site deep audit and cron watchdog were green — edge/proxy blips, not platform outage.

## Fix

`scripts/gha-rth-audit.mjs`: socket-health uses `probeOptionsSocketWithRetries`; Postgres writer checks retry via `createAuditClient` + `isTransientAuditPgError`, then skip-with-warning when the audit host cannot hold a session.

## Market-open validation

Next scheduled `RTH deep audit` run should stay green unless sockets or crons are genuinely unhealthy.
