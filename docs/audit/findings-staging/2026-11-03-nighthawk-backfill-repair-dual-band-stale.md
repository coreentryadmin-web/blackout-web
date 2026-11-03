> **kind:** FINDING

## `nighthawk-backfill-repair` false stale in CI `query` between dual-band UTC ticks — FIXED

| | |
|---|---|
| **Area** | `src/lib/admin-cron-health.ts` + `src/lib/cron-schedule-window.ts` |
| **Status** | FIXED — regression tests added |
| **Severity** | P2 (CI flake + ops noise; not a member-facing outage when cron is healthy) |

### Root cause

`nighthawk-backfill-repair` uses `schedule_cron_utc: "0 13,14 * * 1-5"` (9:00 AM ET dual-band).
Under EST the 13:00 UTC tick is 8:00 AM ET — the route correctly **skips** outside the 9:00 ET
window; the real work runs on the **14:00 UTC** tick.

`isInOffScheduleIdleGap()` treats the 1h gap between 13:00 and 14:00 as **in-schedule** (by
design — hourly crons must still page on a missed :20). So between ~13:01–13:59 UTC the health
board marks a never-run or weekend-stale job as **`stale`**, and `cron-audit-query.mjs` exits 1
with `problem_keys: nighthawk-backfill-repair`. Same commit passed when the workflow ran outside
that window (measured CI run `41649123458` at 13:59 UTC vs green run earlier).

### Fix

Added `isInSameDayDualBandRetryWindow()` for same-UTC-day fire pairs ≤2h apart. `evaluateJob`
suppresses never-run / age-stale (not **failed**) while sitting in that window — same discipline as
off-schedule idle suppression.

### Evidence

`node --import tsx -e` against `evaluateJob` pre-fix: never-run at `2026-11-03T13:59Z` → `stale`;
post-fix → `unknown` (watchdog excludes unknown from `problem_keys`).
