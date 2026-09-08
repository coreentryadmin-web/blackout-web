# 2026-09-05 — Banger live-sync missing railway TOML — FIXED

## Problem

`banger-live-sync` was registered in `cron-registry.ts` with `schedule_cron_utc` and
`produces_member_alert: true`, but had no `railway.banger-live-sync.toml`. The deployed
`cron-jobs.json` manifest is generated from TOMLs with no merge — a sync run would delete the
hand-edited schedule silently while the route still reports healthy.

## Fix

- Added `railway.banger-live-sync.toml` with `cronSchedule = "*/5 11-21 * * 1-5"` (matches registry)
- Removed `banger-live-sync` from `NO_BACKING_TOML` exemption list in `cron-registry-schedule.test.ts`

## Verification

```bash
node --import tsx --test src/lib/cron-registry-schedule.test.ts
```
