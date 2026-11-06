> **kind:** FINDING

## Cron audit query failed: spx-evaluate + spx-issues-sync stale 16:05–16:14 ET

| **Status** | FIXED |

### What was broken

**Cron audit query** (HTTP watchdog) exited 1 on **2026-11-06 ~17:54 UTC** with `problems: spx-evaluate, spx-issues-sync`. Those routes use `isSpxEngineCronWindow` (**7:00–16:15 ET** weekdays). Cron health used `isEtCashRth` (**9:30–16:00 ET**) for `market_hours_only`. Between **16:01 and 16:14 ET**, last runs were still fresh skips from the engine window, but health treated the clock as "market closed" and flagged **stale** — false P0.

### Fix

`inMarketHoursWindowForJob` — for `spx-evaluate` and `spx-issues-sync`, gate on `isSpxEngineCronWindow(now)` instead of `isEtCashRth(now)`. Wired through `evaluateJob` and the `spx-evaluate` heartbeat override’s `offWindow` check.

### Verify

Regression test at Fri **16:10 ET** — both keys stay **healthy** with a recent `ok` run.
