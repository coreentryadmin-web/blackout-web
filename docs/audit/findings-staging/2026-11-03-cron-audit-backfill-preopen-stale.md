> **kind:** FINDING

## 2026-11-03 — Cron audit query: nighthawk-backfill-repair false stale pre-9:10 ET — FIXED

| **Status** | FIXED on `fix/cron-audit-nighthawk-backfill-preopen` |
| --- | --- |

**Symptom:** `Cron audit query` on `main` @ `6220d950` failed: watchdog `problem_keys` included `nighthawk-backfill-repair` at ~8:58 AM ET.

**Root cause:** Health board treated weekend-aged `cron_job_runs` as stale during the short UTC dual-band gap before the 9:10 ET morning window, while the dedicated EventBridge rule for backfill-repair is still not provisioned.

**Fix:** Suppress pre-9:10 ET staleness for morning-band crons; morning-confirm delegates to `/api/cron/nighthawk-backfill-repair` in-window so repair runs and logs even without a separate schedule.

**Verify:** Re-run `node scripts/cron-audit-query.mjs` before 9:10 ET — backfill-repair should not appear in `problem_keys`.
