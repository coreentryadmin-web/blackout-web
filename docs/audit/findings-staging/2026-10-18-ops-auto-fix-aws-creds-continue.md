# ops-auto-fix died on invalid GitHub AWS keys — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Area** | GitHub Actions / ops-auto-fix |
| **Status** | FIXED |

## Symptom

After `Deploy smoke` failed on a real prod 503 outage (`be77ca75`), the chained `Ops auto-fix` `collect-and-dispatch` job failed at `configure-aws-credentials` with **invalid security token** — before `ops:collect` could run or dispatch an agent.

## Root cause

`aws-actions/configure-aws-credentials` is a hard gate with no `continue-on-error`. Stale/rotated `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` repo secrets abort the workflow even though `ops-collect-action-items.mjs` can fall back to `CRON_SECRET` / `DATABASE_PUBLIC_URL` from GitHub secrets.

## Fix

- `continue-on-error: true` on AWS configure + workflow warning.
- Pass `CRON_SECRET` and `DATABASE_PUBLIC_URL` into the collect step env (same pattern for SPX backlog agent ops pre-check).

## Evidence

GHA run `39150544495` on `be77ca752`: configure-aws-credentials exhausted 12 retries, "security token included in the request is invalid".

| **Status** | FIXED — PR pending merge |
