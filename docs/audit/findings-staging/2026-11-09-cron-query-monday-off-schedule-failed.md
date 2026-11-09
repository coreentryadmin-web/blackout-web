> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | Cron audit query RED Monday AM on Friday post-close failures |
| **Status** | FIXED |

## What broke

`cron-audit-query` run **42649315653** (Mon 2026-11-09 15:55 UTC / 10:55 AM ET): watchdog problems `spx-evaluate`, `nighthawk-outcomes`, `gex-eod-snapshot`, `banger-discovery`. Weekend suppression shipped Sat; Monday before post-close UTC bands still counted Friday `failed` handshakes.

## Fix

`evaluateJob`: suppress `failed` last runs while `isInOffScheduleIdleGap` (not between dual UTC bands). `buildCronHealthSnapshot`: SPX engine heartbeat can override `failed` cron handshake when HB is fresh (same as stale handshake).

## Verify

`npx tsx --test src/lib/admin-cron-health.test.ts`; next scheduled query on `main`.
