# Cron audit query — nighthawk-backfill-repair pre-window false positive

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

Scheduled `Cron audit query` on `main` (`6220d950`, 2026-11-03 ~13:59 UTC) failed:

```
problems: nighthawk-backfill-repair
```

Watchdog HTTP fallback only — no code regression in that merge.

## Root cause

`nighthawk-backfill-repair` uses dual-band UTC (`0 13,14 * * 1-5`) so one tick lands in the 9:00 AM ET
repair window in both DST regimes. During EST, the 13:00 UTC tick is **before** the route's
`inEtWindow` (9:00 + 90m catchup).

`admin-cron-health` treated the short gap between 13:00 and 14:00 UTC as **in-schedule** (not an idle
gap), so a job with no logged run yet read **stale** at 8:59 AM ET — before the real run window
opens.

## Fix

Add optional `et_due_window` on cron registry entries (mirrors route `inEtWindow` targets). Health
evaluation suppresses never-run / stale alarms until that ET target on trading days. Also tighten
off-schedule idle suppression so post-catchup misses still page.

## Verify

- `npx tsx --test src/lib/admin-cron-health.test.ts`
- After deploy: `npm run validate:cron` green on a weekday before 9:00 AM ET
