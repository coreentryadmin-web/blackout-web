## 2026-10-29 — [FINDING, P2 CI / Ops] `Cron audit query` failed on transient Cloudflare HTTP 520 — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR pending) |
| **Found by** | CI on `main` @ `c722f91eb`, run `40920760516`, 2026-10-29 |
| **Scope** | `scripts/cron-audit-query.mjs`, `scripts/audit/lib/auth-status.mjs` |

### Root cause

GitHub Actions uses the HTTP `cron-staleness-watchdog` fallback (private VPC Postgres). A single
probe returned **HTTP 520** (Cloudflare origin blip during deploy/rollout). `ops-collect` already
retries 502/503/504/524, but `cron-audit-query` did one fetch and exited 1 — no retry, and 520 was
not classified as transient.

### Fix

- Classify Cloudflare **520–523** as transient in `isTransientOriginError` (shared with ops collect).
- `auditViaWatchdog`: 3× backoff retry via `shouldRetryWatchdogFetch`, including fetch throws (`status 0`).

### Regression guard

`scripts/audit/lib/ops-collect-scope.test.mjs` — 520 retry + P2 priority.
