## 2026-11-06 — [FINDING] Cron audit query false P0 on spx-evaluate / spx-issues-sync

> **kind:** `FINDING`

### Summary

`cron-audit-query` (HTTP watchdog path) listed `spx-evaluate` and `spx-issues-sync` as problems because `admin-cron-health` treated them as “off market” using cash RTH (`isEtCashRth`) while the routes actually run through `isSpxEngineCronWindow` (7:00–16:15 ET). In the post-cash / pre–16:15 ET tail, skipped handshakes looked healthy and missed ticks could be under-reported. The registry also lacked `schedule_cron_utc`, so deployed cadence did not feed `isInOffScheduleIdleGap()` for these jobs.

| **Status** | FIXED (this PR) |
| --- | --- |
| **Root cause** | Window mismatch: health “due” gate ≠ route gate; missing `schedule_cron_utc` for watchdog schedule awareness |
| **Fix** | `schedule_cron_utc` from `railway.spx-*.toml`; `marketHoursJobDue()` uses `isSpxEngineCronWindow` for those keys; single `now` for snapshot + `generated_at` alignment |
| **Tests** | `src/lib/admin-cron-health.test.ts` post-cash in-engine-window staleness; `cron-registry-schedule.test` continues to enforce TOML match |
