# Cron audit query P0 Monday morning on post-close weekday crons

> **kind:** `FINDING`

### Summary
`cron-audit-query` run **42649315653** (Mon 2026-11-09 15:54 UTC / 10:54 ET) reported
`problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery`.

### Root cause
Weekend post-close suppression (#2026-11-08) only cleared stale/failed when
`!isTradingDayEt(now)`. Monday morning is a trading day but still inside
`isInOffScheduleIdleGap` until the evening UTC band fires — Friday's `failed`
handshake remained a P0.

`spx-evaluate` can separately fail CI when `cron_job_runs` shows `failed` while the
play-engine heartbeat is fresh (same desync class already handled for stale age).

### Fix
- Drop the `!isTradingDayEt` guard; suppress stale/failed for all weekday-scheduled
  crons inside off-schedule idle gaps (trading or non-trading day labels).
- Trust a non-stale play-engine heartbeat over a `failed` cron handshake in-window.

| **Status** | FIXED — this PR |
