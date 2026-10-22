> **kind:** FINDING

## zerodte-warm scan heartbeat `critical_stale` during RTH — scan hung past 10m watchdog

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**Symptom:** Scheduled `Cron audit query` on `main` failed with `problems: zerodte-warm` while prod HTTP stayed healthy (`0301d512`, 2026-10-22 ~15:50Z).

**Root cause:** `recordZeroDteScanTick("cron")` ran only after `scanZeroDteBoard()` returned. A child fetch with no deadline (or a wedged overlap/heavy-slot skip) could leave the heartbeat silent for >10m even though `cron_job_runs` logged ok/skipped.

**Fix:**
1. `awaitWithWarmDeadline` on the warm cron path (default 8m, `ZERODTE_SCAN_WARM_TIMEOUT_MS`) — on timeout/error, record heartbeat and skip persist for that cycle.
2. Wedged-lock steal + heavy-slot escalation when heartbeat is `stale` (>5m) or `critical_stale` (>10m) during cash RTH (~5m earlier recovery).

**Verify:** RTH `node scripts/cron-audit-query.mjs` green; CloudWatch `[zerodte-scan] … warm deadline` should be rare, not sustained `critical_stale`.
