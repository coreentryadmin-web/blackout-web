> **kind:** FINDING

## `query` CI red: nighthawk-backfill-repair stale between dual-band fires — FIXED

| | |
|---|---|
| **Area** | `src/lib/admin-cron-health.ts`, `src/lib/cron-dispatch.ts`, `src/app/api/cron/nighthawk-morning-confirm/route.ts` |
| **Status** | FIXED — regression tests in `src/lib/admin-cron-health.test.ts` |
| **Severity** | P2 (CI / watchdog false positive; dedicated EventBridge rule still pending in blackout-infra) |

### Root cause

`GET /api/cron/cron-staleness-watchdog` (and CI `scripts/cron-audit-query.mjs` HTTP fallback) flagged
`nighthawk-backfill-repair` on `main` @ `6220d950` (GitHub Actions run `41649123458`, 2026-11-03
13:59 UTC ≈ 8:59 AM ET).

Schedule `0 13,14 * * 1-5` is correct for 9:00 AM ET in both DST regimes, but in EST the 13:00 UTC
band fires at 8:00 AM — the route intentionally skips outside the 9:00 AM repair window. The
actionable band is 14:00 UTC (9:00 AM ET). `isInOffScheduleIdleGap` treats the 1h gap between bands
as in-window (gap < 2h), so a job with **no** `cron_job_runs` row read **STALE** at 8:59 ET even
though the second band had not fired yet.

Separately, production may still lack the EventBridge rule entry in blackout-infra
(`MARKET-OPEN-VALIDATION.md` 2026-10-25); `nighthawk-morning-confirm` **does** fire and now dispatches
the repair handler so `cron_job_runs` gets populated even without the dedicated schedule.

### Fix

1. **Watchdog / health board:** for never-logged jobs, suppress stale during short inter-band gaps
   and re-flag stale after today's final scheduled fire + 15m grace (`evaluateJob` in
   `admin-cron-health.ts`).
2. **Prod self-heal path:** register `nighthawk-backfill-repair` in `CRON_DISPATCH` and call
   `dispatchCronWarm("nighthawk-backfill-repair")` at the start of `nighthawk-morning-confirm`
   (idempotent; logs under the dedicated job key).

### Evidence

- CI log: `problems: nighthawk-backfill-repair` at `checked: 50`, watchdog fallback after private VPC DB.
- RED→GREEN: `npx tsx --test src/lib/admin-cron-health.test.ts` (dual-band 13:59 unknown, 14:20 stale).
