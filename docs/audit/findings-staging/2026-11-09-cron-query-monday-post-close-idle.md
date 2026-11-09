> **kind:** FINDING

| **Status** | FIXED |

## What broke

`cron-audit-query` run **42649315653** (Mon 2026-11-09 15:55 UTC / 10:55 AM ET):
watchdog problems `spx-evaluate`, `nighthawk-outcomes`, `gex-eod-snapshot`, `banger-discovery`.

Post-close weekday crons already had `isInOffScheduleIdleGap` true Monday morning, but
`evaluateJob` only suppressed `failed`/`stale` on **non-trading** days — Friday `failed`
handshakes still P0'd query.

## Fix

`scheduledCronIdleGap`: apply the same stale/failed downgrade whenever `weekdays_only` +
`isInOffScheduleIdleGap`, trading day or not.

## Verify

`npx tsx --test src/lib/admin-cron-health.test.ts` Monday 15:55Z case; redeploy + re-run query.
