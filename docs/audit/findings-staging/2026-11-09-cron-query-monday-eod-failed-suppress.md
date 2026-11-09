# Cron audit query: Monday false-P0 on post-close jobs (Friday failed handshake)

> **kind:** FINDING

| **Status** | FIXED |
| --- | --- |

## Symptom

`Cron audit query` on `main` failed (runs 42649315653 @ 15:55 UTC, overnight cbdfc08) with:

```text
problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery
```

Overnight pass was **only** the three EOD keys — no `spx-evaluate`.

## Root cause

Weekend suppression (`nonTradingScheduledIdle`) already clears stale/failed for Saturday/Sunday. On **Monday before the post-close UTC band**, `isInOffScheduleIdleGap` is true, but `last.status === "failed"` short-circuited before off-schedule suppression — Friday's failed handshake stayed `failed` and failed CI.

## Fix

`evaluateJob`: when `schedule_cron_utc` is in an off-schedule idle gap (or awaiting dual UTC band), treat `failed` like off-gap `ok`/`skipped` → healthy idle label.

## Verification

- `src/lib/admin-cron-health.test.ts` — Monday 10:55 ET + Friday failed row
- Re-run `Cron audit query` on `main` after merge
