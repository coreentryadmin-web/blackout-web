# SPX backlog agent: continue when GitHub AWS creds invalid

> **kind:** FINDING

| **Status** | FIXED (pending merge) |
|------------|------------------------|
| **Date** | 2026-10-18 |

## Symptom

Commit `baec3f755` CI: `collect-and-dispatch` failed on **SPX platform backlog agent** (not ops-auto-fix) — `configure-aws-credentials` hard-failed with invalid security token; job never reached ops pre-check.

## Root cause

`ops-auto-fix.yml` gained `continue-on-error` on AWS (#6204); `spx-platform-backlog-agent.yml` did not.

## Fix

Mirror ops-auto-fix: `continue-on-error: true` + warning step on `aws_creds` failure.
