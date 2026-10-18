# 2026-10-18 — ops-auto-fix collect-and-dispatch hard-fails on invalid AWS GHA creds — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Priority** | P1 ops / false RED on `main` |
| **Found by** | Cursor — CI `collect-and-dispatch` failure alongside Deploy smoke 503 @ `be77ca75` |
| **Status** | FIXED — AWS configure step `continue-on-error`; collect gets `CRON_SECRET` + `DATABASE_PUBLIC_URL` from GitHub secrets |

## Root cause

`ops-auto-fix.yml` required `aws-actions/configure-aws-credentials` to succeed before `ops-collect-action-items.mjs` ran. GitHub `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` returned **invalid security token** (2026-10-18), so the job failed even though `CRON_SECRET` was valid and the collector could still detect the live **HTTP 503** outage.

Deploy **smoke** failed separately: `/api/health` never recovered during `gha-wait-deploy` (real origin outage — Cloudflare 503, not app JSON).

## Fix

- `.github/workflows/ops-auto-fix.yml` — optional AWS creds + explicit GitHub secret env for collect

## Test

Manual: re-run Ops auto-fix workflow after merge; job must reach "Collect action items" when AWS creds are bad but `CRON_SECRET` is set.
