# ops-auto-fix hard-failed when GitHub AWS secrets are invalid — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-ops-auto-fix-aws-fallback |
| **Priority** | P2 |
| **Area** | GitHub Actions / ops-auto-fix |
| **Status** | FIXED |

## Symptom

`collect-and-dispatch` job failed at `configure-aws-credentials` with
`The security token included in the request is invalid` (run 39150544495),
blocking issue dispatch during the 2026-10-18 production outage.

## Root cause

Workflow treated AWS credential configuration as a hard gate. When GitHub
`AWS_*` secrets are stale, the job never reached `ops-collect-action-items.mjs`,
which can fall back to `CRON_SECRET` / `DATABASE_PUBLIC_URL` from GitHub env.

## Fix

`ops-auto-fix.yml`: `continue-on-error` on AWS configure, clear invalid AWS env
on failure, pass `CRON_SECRET` and `DATABASE_PUBLIC_URL` into the collect step.

## Evidence

Workflow change only; collect path already supports env fallbacks via `auditSecret`.
