# 2026-10-18 — SPX backlog agent hard-fails on invalid GHA AWS creds — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Priority** | P2 CI noise on `main` |
| **Found by** | Cursor — `collect-and-dispatch` RED @ `baec3f755` (SPX platform backlog agent, not ops-auto-fix) |
| **Status** | FIXED — mirror ops-auto-fix optional AWS + GitHub secret env on ops gate step |

## Root cause

`spx-platform-backlog-agent.yml` required AWS configure to succeed before the prod ops gate (`ops-collect-action-items.mjs`) ran. Invalid GHA `AWS_*` keys failed the job even though `CRON_SECRET` could still detect the live outage.

## Fix

`.github/workflows/spx-platform-backlog-agent.yml`
