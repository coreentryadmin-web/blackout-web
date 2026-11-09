> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | Cron audit query P0 Monday AM on post-close weekday crons (Friday failed) |
| **Status** | FIXED |

## What broke

`cron-audit-query` run **42649315653** (Mon 2026-11-09 15:55 UTC ≈ 10:55 AM ET): watchdog problems included `nighthawk-outcomes`, `gex-eod-snapshot`, `banger-discovery`. Saturday suppression (#7613 / `nonTradingScheduledIdle`) only applied on non-trading ET days; on **Monday morning** the same Fri→Mon off-schedule idle gap left Friday `failed` handshakes alerting.

## Fix

`evaluateJob`: extend ops #1983 suppression — any `weekdays_only` job in `isInOffScheduleIdleGap` downgrades `stale`/`failed` → healthy (trading or non-trading day label).

## Verify

`npx tsx --test src/lib/admin-cron-health.test.ts` Mon 10:55 ET case; cron-audit query should not list post-close trio pre-window.
