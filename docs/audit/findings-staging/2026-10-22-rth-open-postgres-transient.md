# RTH open-check false fail on transient Postgres disconnect from GHA — FIXED

> **kind:** FINDING

| Field | Value |
|-------|--------|
| **Status** | FIXED |
| **Area** | CI / rth-open-check |

## Symptom

`open-check` on `ae00300c` failed: `Postgres RTH checks: Connection terminated unexpectedly` while deploy validation and socket probes were GREEN.

## Root cause

`isPrivateDbUnreachableError` matched `ECONNRESET` but not the pg driver's "Connection terminated unexpectedly" string, so `rth-open-check.mjs` treated a flaky GHA→`DATABASE_PUBLIC_URL` session as a hard RTH failure.

## Fix

Extend `isPrivateDbUnreachableError` to include terminated/closed-unexpectedly messages (same warn-skip path as other unreachable errors).
