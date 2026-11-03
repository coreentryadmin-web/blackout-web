> **kind:** FINDING

## Cron audit false-positive on `nighthawk-backfill-repair` between dual-band UTC fires — FIXED

| | |
|---|---|
| **Area** | `src/lib/cron-schedule-window.ts`, `src/lib/admin-cron-health.ts`, `src/app/api/cron/nighthawk-backfill-repair/route.ts` |
| **Status** | FIXED — unit tests added |
| **Severity** | P2 (CI `query` job red; prod watchdog listed the job stale before the EST in-window band fired) |

### Root cause

`nighthawk-backfill-repair` uses the same dual-band UTC schedule as `nighthawk-morning-confirm` and
`largo-morning-brief` (`0 13,14 * * 1-5`): only one band lands in the route's 9:00 ET window per
DST offset. `isInOffScheduleIdleGap` treats the 1h gap between 13:00 and 14:00 as **in-schedule**
(gap ≤ 2h), so off-schedule stale suppression does not apply.

The hourly `cron-audit-query` workflow runs at **:05** UTC (including **13:05–13:59**). On EST
weekdays the meaningful fire is **14:00 UTC** (9:00 ET). Before that second band, the last logged
run is often still Friday's in-window pass — age ≫ 36h — so `evaluateJob` reported **stale** even
though the job was not yet due to execute for the session.

Measured: GitHub Actions run 41649123458 @ 2026-11-03T13:59Z flagged
`problems: nighthawk-backfill-repair` while the same commit was green at 00:50Z (off-schedule idle
gap suppression overnight).

### Fix

- Added `isInDualBandSameDayGrace()` — true between two same-day UTC fires when the inter-fire gap
  is ≤ 2h (dual-band DST shape).
- `evaluateJob` suppresses stale (and never-run → `unknown`) during that grace window, same
  discipline as off-schedule idle suppression.
- Aligned off-window skip payload to `{ ok: true, skipped: true }` like `largo-morning-brief` so
  the pre-window band logs a heartbeat, not a pseudo-failure.

### What to verify on next EST open

After **14:00 UTC**, confirm `cron_job_runs` logs a row for `nighthawk-backfill-repair` with
status `ok` or `skipped` (not absent). If still no row after 14:05 UTC, EventBridge provisioning
(`blackout-infra` sync from `railway.nighthawk-backfill-repair.toml`) remains the real gap — this
fix only stops the pre-window false alarm.
