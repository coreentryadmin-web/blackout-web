> **kind:** FINDING

## Cron audit query P0 on post-close jobs every Monday pre-fire — FIXED

| **Status** | FIXED |
|---|---|
| **What broke** | Scheduled Cron audit query on `main` flagged `nighthawk-outcomes`, `gex-eod-snapshot`, `banger-discovery` while still in the off-schedule idle gap before the day's UTC fire — because `evaluateJob` surfaced `Last run failed` from the prior session and did not suppress `failed` the way it already suppressed stale for `ok`/`skipped`. |
| **Fix** | `admin-cron-health.ts`: treat `failed` like off-schedule idle when `offScheduleGap` or `awaitingDualBand`. |
| **Note** | Same ticks may still flag `spx-evaluate` when the engine path is genuinely stale during RTH — that is intentional. |
