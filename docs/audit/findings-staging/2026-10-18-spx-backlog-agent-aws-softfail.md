# SPX platform backlog agent — AWS configure hard-fail paints main red

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

On `main@baec3f755`, branch CI reported **2 failures**: `smoke` (origin `/api/health` down) and **`collect-and-dispatch`** from workflow **SPX platform backlog agent** (not Ops auto-fix). Run `39155017489`: step **Configure AWS credentials** failed with invalid security token; job exited before the ops deferral probe could run.

## Root cause

`ops-auto-fix.yml` already uses `continue-on-error` on AWS configure (#6214) plus GitHub secret fallbacks for `ops:collect`. `spx-platform-backlog-agent.yml` still hard-failed the homonymous job when IAM-invalidated GHA AWS keys rejected configure — a duplicate check name on `main` made the outage look like a second automation regression.

## Fix

Mirror ops-auto-fix: `continue-on-error` + warning step; pass `CRON_SECRET` / `DATABASE_PUBLIC_URL` / `AWS_REGION` into the deferral `ops-collect` step so prod P0 items are detected without Secrets Manager.

## Verify

- After merge: next **SPX platform backlog agent** run should stay **green** (or defer with exit 0) when AWS configure fails but GitHub fallbacks work.
- `smoke` remains red until origin health recovers — intentional.
