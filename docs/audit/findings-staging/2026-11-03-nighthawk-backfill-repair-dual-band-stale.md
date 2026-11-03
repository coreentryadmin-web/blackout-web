> **kind:** FINDING

## nighthawk-backfill-repair cron-audit false stale after EST — FIXED

| **Status** | Fixed in `fix/nighthawk-backfill-repair-est-dual-band` |
| **Area** | `nighthawk-backfill-repair`, `admin-cron-health`, `cron-schedule-window` |
| **CI** | `query` / `cron-audit-query` run `41649123458` on `6220d950` (2026-11-03 ~13:58 UTC) |

**What was broken:** After DST ended, the first dual-band UTC fire (`13:00` = 8:00 AM ET) intentionally skips outside the 9:00 AM repair window. The cron-audit watchdog (`GET /api/cron/cron-staleness-watchdog`) flagged `nighthawk-backfill-repair` as stale between that early skip and the in-window `14:00` UTC fire, because `isInOffScheduleIdleGap` treats the 1-hour intra-band gap as “due” (not a long idle gap) while the last *meaningful* ok run could still be from the prior session.

**What changed:**

- Off-window schedule hits return `ok: true, skipped: true` (same discipline as `largo-morning-brief`).
- `isInDualBandPreEtWindowIdleGap()` + health suppression when today’s early band logged skip/ok but ET window has not opened yet.

**Verify:** On a weekday after EST, between 8:00–8:59 AM ET, admin cron health for `nighthawk-backfill-repair` should read healthy/idle (not stale) once the 13:00 UTC skip is logged; after 9:00 AM ET the 14:00 UTC run should log ok or intentional skip.
