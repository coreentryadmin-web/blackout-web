# GHA RTH deep audit flaky on Postgres ECONNRESET + socket-health 503

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — `RTH deep audit` false RED |
| **Discovered** | 2026-10-22 run 39836457065 on `main` `7b0f46b` |

## Symptom

Workflow `audit` failed: `postgres: read ECONNRESET` and `socket-health: HTTP 503`. Full-site deep audit reported a P1 Night Hawk premium-cap notice but exits 0 on P1-only.

## Root cause

`gha-rth-audit.mjs` Postgres catch treated `ECONNRESET` as a hard failure (regex omitted it). No retry on Postgres or socket-health during transient proxy/ALB blips.

## Fix

Reuse `isTransientPostgresAuditError` + 3× retry (same as `rth-open-check.mjs`). Classify transient drops as SKIP-not-fail after retries. One 4s retry on socket-health 502/503.

## Evidence

Run 39836457065 at 19:02 UTC.
