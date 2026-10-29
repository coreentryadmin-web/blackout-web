# 2026-10-29 cron-audit-query red on transient Cloudflare 520

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 CI |

## What broke

`Cron audit query` on `c722f91e` failed with `[cron-audit] watchdog HTTP 520` — a single GET to `/api/cron/cron-staleness-watchdog` with no retry. Same deploy/edge blip class as 502/503/504 already handled in `ops:collect`.

## Fix

- Classify Cloudflare **520–523** as transient in `isTransientOriginError`.
- `auditViaWatchdog` uses `fetchRetry` + outer attempts (mirrors `ops-collect-action-items.mjs`).

## Verify

- `node --import tsx --test scripts/audit/lib/auth-status.test.mjs`
- `node --import tsx --test scripts/audit/lib/ops-collect-scope.test.mjs`
