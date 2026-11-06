> **kind:** FINDING

## Cron audit query (`query`) false P0 — SPX pipeline crons vs cash-RTH health gate

| **Status** | FIXED |

**Symptom:** Scheduled `query` / cron-audit watchdog on `main` reported `problems: spx-evaluate, spx-signal-observe` (and related SPX pipeline jobs) as stale during weekday premarket while EventBridge was still firing and routes self-gate on `isSpxEngineCronWindow` (7:00 AM–4:15 PM ET), not `isEtCashRth` (9:30 AM–4:00 PM ET).

**Root cause:** `admin-cron-health.ts` treated all `market_hours_only` jobs as “in window” only during cash RTH. SPX engine crons and siblings share the wider engine window in `spx-play-session-guards.ts`, so 7:00–9:30 AM ET was misclassified as off-window — suppressing staleness where runs were actually due, or inverting expectations for never-run vs heartbeat cross-checks.

**Fix:** Use `isSpxEngineCronWindow` for the known SPX pipeline cron keys; keep `isEtCashRth` for other market-hours jobs. Register `schedule_cron_utc` for `spx-evaluate` and `spx-issues-sync` to match deployed TOMLs for idle-gap logic. Add regression tests for premarket ET.

**Verify:** `npx tsx --test src/lib/admin-cron-health.test.ts` GREEN; cron-audit `query` GREEN on `main` when run during premarket ET (no false P0 for healthy skips).
