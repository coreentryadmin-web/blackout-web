# ops-auto-fix blocked on invalid AWS token during prod outage — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-ops-auto-fix-aws-fallback |
| **Priority** | P1 |
| **Area** | GitHub Actions / ops-auto-fix |
| **Status** | FIXED |

## Symptom

On `main@be77ca75`, **Deploy smoke** failed (prod `/api/health` never returned 200 — real Cloudflare 503 origin outage). **ops-auto-fix** `collect-and-dispatch` then failed at `aws-actions/configure-aws-credentials` with *"The security token included in the request is invalid"*, so no issue was opened and no agent dispatched.

## Root cause

`ops-auto-fix.yml` hard-failed when legacy GitHub `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` were stale, before `ops-collect-action-items.mjs` could run. Collect also lacked GitHub `CRON_SECRET` / `DATABASE_PUBLIC_URL` env fallbacks (unlike `rth-open-check.yml`). No unauthenticated `/api/health` probe existed when `CRON_SECRET` was unavailable.

## Fix

- AWS configure step: `continue-on-error: true` + warning when creds invalid.
- Collect step: inject `CRON_SECRET`, `DATABASE_PUBLIC_URL`, `DATABASE_URL` from GitHub secrets.
- `ops-collect`: always probe public `/api/health` (retries) → P0 `site:health` when origin is down.

## Blast radius

ops-auto-fix workflow only. Does not restore prod — ECS/origin recovery remains operator/infra.

## Evidence

`npx tsx --test scripts/audit/lib/ops-collect-scope.test.mjs` — site health helpers pass.
