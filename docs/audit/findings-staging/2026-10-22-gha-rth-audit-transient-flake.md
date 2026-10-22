# GHA RTH deep audit RED on transient socket-health 503 + Postgres ECONNRESET

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — CI monitor noise |
| **Discovered** | RTH deep audit run 39836457065 on `main@7b0f46b` |

## Symptom

`audit` job failed with `socket-health: HTTP 503` and `postgres: read ECONNRESET` while full-site deep audit reported 39 passes (one P1 nighthawk premium-cap finding does not fail the harness).

## Root cause

`scripts/gha-rth-audit.mjs` treated a single socket-health HTTP 503 and a single RDS proxy `ECONNRESET` as hard failures. `scripts/rth-open-check.mjs` already retries both paths via `probeOptionsSocketWithRetries` and `isTransientAuditPgError`.

## Fix

Align GHA RTH audit: retry Postgres up to 3× then skip on transient errors; probe socket-health with the shared retry helper.

## Evidence

Run 39836457065 — deploy validation green; cron routes ok except socket-health 503; Postgres died on first connect reset.
