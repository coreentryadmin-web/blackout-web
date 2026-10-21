> **kind:** FINDING

## zerodte-warm starved on heavy-cron shared pool → RTH scanner critical_stale — FIXED

| **Status** | FIXED |
|------------|-------|

**Symptom:** Cron audit query (`query` check) failed on `main` with `problems: zerodte-warm` (HTTP watchdog fallback); prod `zerodte_scan_heartbeat` critical_stale during RTH.

**Root cause:** `zerodte-warm` competed for the same 2 shared heavy-cron slots as multi-minute vector/bie jobs; repeated `heavy-cron concurrency slot unavailable` skips advanced the fast cron handshake but not the scanner tick.

**Fix:** Dedicated reserved heavy-cron slot for `zerodte-warm` (same pattern as `swing-active-refresh`); clear reserved slot on critical-stale steal recovery. Dedupe watchdog problem keys in `cron-audit-query.mjs` output.
