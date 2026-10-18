# SPX platform backlog agent hard-fails on stale GitHub AWS creds — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P2 |
| **Area** | ops / spx-platform-backlog-agent |
| **PR** | fix/spx-backlog-agent-aws-soft-fail |

## Symptom

Scheduled **SPX platform backlog agent** run on `baec3f755` reported CI failure **`collect-and-dispatch`** (same job name as ops-auto-fix, different workflow). Job died at **Configure AWS credentials** (`invalid security token`) and skipped the ops defer + backlog collect steps.

## Root cause

`spx-platform-backlog-agent.yml` required successful AWS configure before any work, unlike `ops-auto-fix.yml` which already soft-fails invalid GitHub AWS keys.

## Fix

Mirror ops-auto-fix: `continue-on-error` on AWS configure, warning step, and pass `CRON_SECRET` / `DATABASE_PUBLIC_URL` into the ops defer `ops:collect` step.

## Evidence

GHA run `39155017489` (event: schedule, workflow SPX platform backlog agent).
