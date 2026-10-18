# ops-auto-fix hard-fails when GitHub AWS secrets are stale — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P2 |
| **Area** | ops / ops-auto-fix |
| **PR** | fix/ops-auto-fix-aws-soft-fail |

## Symptom

After **Deploy smoke** failed on a production 503 (`be77ca752`), the chained **Ops auto-fix** run failed at **Configure AWS credentials** (`The security token included in the request is invalid`) and never reached `ops:collect` or agent dispatch.

## Root cause

`ops-auto-fix.yml` required a successful `aws-actions/configure-aws-credentials` step before collection. When repo `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are stale, the job exits even though `ops-collect-action-items.mjs` can still run HTTP watchdog checks using `CRON_SECRET` from GitHub Actions secrets (`auditSecret` env fallback).

## Fix

- `continue-on-error: true` on AWS configure + workflow warning when skipped.
- Pass `CRON_SECRET` and `DATABASE_PUBLIC_URL` into the collect step explicitly so GitHub secret fallbacks work without Secrets Manager.

## Evidence

- Failed run `39150544495` — AWS step exit before collect.
- `auditSecret()` in `prod-secrets.mjs` falls back to `process.env[key]` when SM load fails.
