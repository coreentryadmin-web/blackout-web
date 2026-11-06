> **kind:** FINDING

## cron-audit query false green for spx-evaluate / spx-issues-sync (16:00–16:15 ET) — FIXED

| **Status** | Fixed in `fix/cron-health-spx-engine-post-close-window` |
| **CI** | Cron audit query run `42265738332` (2026-11-06 ~12:54 ET) |

**What was broken:** `market_hours_only` jobs used `isEtCashRth` only (9:30–16:00 ET). `spx-evaluate` and `spx-issues-sync` routes run through `isSpxEngineCronWindow` until **16:15 ET**. Between 16:00 and 16:15, last ok runs ~30m old were treated as "market closed" and suppressed staleness while the crons were still in-window — cron-audit saw real staleness as healthy.

**What changed:** `inMarketHoursCronWindow(job)` uses `isSpxEngineCronWindow` for those two keys; other jobs keep `isEtCashRth`.

**Verify:** During a weekday 16:05–16:14 ET tick, if last `spx-evaluate` run is >20m old, watchdog should list it in `problem_keys` until the next tick lands.
