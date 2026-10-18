# Ops auto-fix blocked on invalid GitHub AWS credentials — FIXED (workflow fallback)

> **kind:** FINDING

| Field | Value |
|-------|--------|
| **Status** | FIXED (workflow + collect probe) |
| **Area** | CI / ops-auto-fix |
| **Severity** | P1 (blocks agent dispatch during prod outages) |

## Symptom

`main` CI: `collect-and-dispatch` and manual `ECR push (production)` failed at `aws-actions/configure-aws-credentials@v6` with *The security token included in the request is invalid*. Deploy smoke failed because `/api/ready` stayed 503 (ALB has no healthy ECS targets).

## Root cause

GitHub Actions `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are stale or revoked. `ops-auto-fix.yml` treated AWS configure as a hard gate, so `ops-collect-action-items.mjs` never ran and no `ops-auto-fix` issue/agent was dispatched for the live 503 outage.

## Fix

- `ops-auto-fix.yml`: `continue-on-error` on AWS configure; pass `CRON_SECRET` and `DATABASE_PUBLIC_URL` from GitHub secrets as fallbacks.
- `ops-collect-action-items.mjs`: unconditional `GET /api/health` probe with `platformHealthPriority` (503 → P0).
- `docs/ops/OPS-AUTO-FIX.md`: document AWS rotation requirement.

## Not fixed in repo

Production ECS recovery and ECR deploy still require operator IAM key rotation in GitHub + infra triage.

## Verify

```bash
npx tsx --test scripts/audit/lib/ops-collect-scope.test.mjs
node scripts/ops-collect-action-items.mjs --pretty   # expect platform:health P0 when prod 503
```
