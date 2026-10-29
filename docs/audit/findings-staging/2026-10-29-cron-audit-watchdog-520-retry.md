> **kind:** FINDING

## Cron audit query watchdog HTTP 520 — transient CI RED — FIXED

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**Observed (2026-10-29 ~17:24 UTC, `Cron audit query` run 40920760516, commit `c722f91eb`):**

Private-VPC DB path uses HTTP watchdog fallback. Single bare `fetch` to `/api/cron/cron-staleness-watchdog` returned **HTTP 520** (Cloudflare/origin blip) → exit 1 with no retry.

**Fix:** Use shared `fetchRetry` (4×, 2.5s backoff; 520 is retryable as ≥500).

**Verify:** Next scheduled `cron-audit-query` GREEN unless watchdog reports real stale crons.
