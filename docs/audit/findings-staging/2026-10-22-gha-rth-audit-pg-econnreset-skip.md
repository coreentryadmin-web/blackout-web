# gha-rth-audit: skip Postgres when GHA cannot reach private RDS (ECONNRESET)

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## Symptom

RTH deep audit on `7b0f46b01`: `postgres: read ECONNRESET` failed the job; `socket-health` also 503 (transient). Separate P1 `PREMIUM-CAP` on Night Hawk CRL logged in data audit.

## Root cause

`postgresRthChecks()` treated `ECONNRESET` as a hard failure; `isConfig` regex omitted `ECONNRESET` / connection-terminated (unlike `rth-open-check` via `isPrivateDbUnreachableError`).

## Fix

Use shared `isPrivateDbUnreachableError()` in the catch classifier.
