# ops:collect under-paged sustained origin 503 — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-ops-origin-outage-p0 |
| **Priority** | P1 |
| **Area** | Ops auto-fix / production outage detection |
| **Status** | FIXED |

## Symptom

2026-10-18 production origin-down (Cloudflare 503 on `/api/health`): `deploy-smoke` failed,
`ops-auto-fix` `collect-and-dispatch` failed on invalid AWS GitHub secrets, and `ops:collect`
only emitted **P2** `watchdog:http` — below dispatch threshold — so no agent issue opened.

## Root cause

1. `watchdogHttpPriority(503)` always returned P2 (deploy-blip design).
2. No public `/api/health` probe to distinguish sustained outage vs transient deploy.
3. `ops-auto-fix.yml` hard-failed when `AWS_ACCESS_KEY_ID` secret was invalid, before collect.

## Fix

- Probe `/api/health` (no auth) with retries; emit **P0** `origin:health` when not ok.
- Escalate watchdog 503 to **P0** when origin liveness is also down.
- AWS configure step `continue-on-error`; pass `CRON_SECRET` + `DATABASE_PUBLIC_URL` from GitHub secrets.

## Evidence

`node --test scripts/audit/lib/ops-collect-scope.test.mjs`
