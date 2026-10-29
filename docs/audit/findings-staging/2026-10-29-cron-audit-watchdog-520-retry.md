# 2026-10-29 — cron-audit-query RED on transient watchdog HTTP 520

> **kind:** FINDING

| Field | Detail |
| --- | --- |
| **Severity** | P2 CI / ops audit |
| **Symptom** | Scheduled `Cron audit query` run [40920760516](https://github.com/coreentryadmin-web/blackout-web/actions/runs/40920760516) failed with `[cron-audit] watchdog HTTP 520` while `/api/health` stayed 200 — not a cron staleness problem. |
| **Root cause** | `auditViaWatchdog()` in `cron-audit-query.mjs` had a single-shot fetch with no retry; HTTP 520 (Cloudflare origin error during deploy/recycle) was not classified as transient. `ops-collect` already retries 502/503/504/524 via `shouldRetryWatchdogFetch`. |
| **Fix** | Retry watchdog fetch up to 3× with backoff (same pattern as `ops-collect-action-items.mjs`); treat HTTP 520 as transient in `isTransientOriginError`. |
| **Status** | FIXED on branch `cursor/bc-200a9b63-5185-4916-bd36-6f4def2b45b9-dd80`. |
