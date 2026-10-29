# Cron audit query fails on single transient watchdog HTTP 520

> **kind:** FINDING

| **Status** | FIXED (pending merge) |
|------------|----------------------|

## Symptom

Scheduled GitHub Actions job `query` (`cron-audit-query.yml`) failed on `main` at `c722f91eb` with:

```
[cron-audit] DB URL is a private VPC endpoint — using HTTP watchdog fallback
[cron-audit] watchdog HTTP 520
```

Run: 40920760516. No cron staleness signal — one-shot Cloudflare/origin error on `GET /api/cron/cron-staleness-watchdog`.

## Root cause

`scripts/cron-audit-query.mjs` `auditViaWatchdog()` used a single `fetch` with no retry. `scripts/ops-collect-action-items.mjs` already retries the same endpoint via `shouldRetryWatchdogFetch` (502/503/504/524). HTTP **520** was not classified as transient.

## Fix

- Retry watchdog up to 3× with backoff in `auditViaWatchdog` (mirror ops-collect).
- Treat HTTP 520 as transient in `isTransientOriginError`.

## Verify

- `npx tsx --test scripts/audit/lib/auth-status.test.mjs scripts/audit/lib/ops-collect-scope.test.mjs`
- Next green scheduled `Cron audit query` on `main` after deploy.
