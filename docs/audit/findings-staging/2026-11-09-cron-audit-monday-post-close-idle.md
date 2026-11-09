> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |

## Cron audit query P0 Monday on post-close weekday crons (ops #1983 follow-up)

### What broke

`cron-audit-query` run **42649315653** (Mon 2026-11-09 10:55 ET / 15:55 UTC): watchdog problems `spx-evaluate`, `nighthawk-outcomes`, `gex-eod-snapshot`, `banger-discovery`. Saturday non-trading suppression (#1983) was not enough: on the first trading day back, Friday stale/failed handshakes still surfaced before Monday's evening UTC band.

### Fix

`evaluateJob`: on trading days, before today's first scheduled `schedule_cron_utc` fire, when the last handshake is >48h old and the job sits in `isInOffScheduleIdleGap`, downgrade `stale`/`failed` → healthy (does not hide same-session failures after today's fire).

### Evidence

- `npx tsx --test src/lib/admin-cron-health.test.ts` Monday pre-close + Tuesday same-day failure cases
- `npx tsx --test src/lib/cron-schedule-window.test.ts`

**Note:** `spx-evaluate` in the same run may be a genuine RTH stall if engine heartbeat is also stale — not addressed by this harness-only gap fix.
