# Ops auto-fix blocked on rotated AWS GitHub secrets

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`ops-auto-fix.yml` `collect-and-dispatch` failed on `main@be77ca752` with `InvalidClientTokenId` at `configure-aws-credentials` — the job never reached `ops-collect-action-items.mjs`, so no GitHub issue or Cloud Agent was dispatched during an active production 503 outage (Deploy smoke also failed on the same push).

## Root cause

The workflow required a successful AWS static-key step before collection, but `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in GitHub Actions secrets were invalid. Collection already documents `CRON_SECRET` and `DATABASE_PUBLIC_URL` as first-class secrets (`docs/ops/OPS-AUTO-FIX.md`); AWS is only needed for optional Secrets Manager enrichment.

## Fix

- `continue-on-error: true` on the AWS credentials step.
- Pass `CRON_SECRET` and `DATABASE_PUBLIC_URL` into the collect step env.
- Add `GET /api/health` P0 `origin:health` item when the origin returns 502/503/504 (watchdog 503 stays P2 for deploy blips).

## Evidence

- GHA run `39150544495`: AWS credentials step failed 12 retries.
- Live probe: `curl https://blackouttrades.com/api/health` → Cloudflare HTML 503.
