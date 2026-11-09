> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | Cron query P0 Monday AM on post-close jobs with Friday failed handshake |
| **Status** | FIXED |

## Root cause

`cron-audit-query` run **42649315653** (Mon 2026-11-09 ~10:54 ET): `nighthawk-outcomes`, `gex-eod-snapshot`, `banger-discovery`, and `spx-evaluate` in `problems`. Saturday off-schedule suppression (PR weekend fix) did not cover **trading-day mornings** before the next UTC fire when `cron_job_runs` last status was `failed` — `evaluateJob` surfaced `failed` before `suppressStaleOffSchedule` (ok/skipped only).

## Fix

`evaluateJob`: when `isInOffScheduleIdleGap` / awaiting dual-band, downgrade `failed` last runs to healthy idle (label notes prior failure) until the next scheduled tick.

## Verify

`npx tsx --test src/lib/admin-cron-health.test.ts` Monday 15:54 UTC case; next `Cron audit query` on `main`.
