## 2026-11-06 — [FINDING, Cron health false P0 — spx-evaluate / spx-issues-sync post-close]

> **kind:** `FINDING`

| Field | Value |
| -------- | ------- |
| **Status** | FIXED (aligned `market_hours_only` schedule with `isSpxEngineCronWindow`) |
| **Area** | Admin cron health / HTTP watchdog (`query` CI) |

### Summary

`evaluateJob` used `isEtCashRth` (~9:30–4:00 ET) for every `market_hours_only` cron. `spx-evaluate` and `spx-issues-sync` routes gate on `isSpxEngineCronWindow` (7:00–4:15 ET) so post-close ticks can run. In the 4:00–4:15 ET band, cash RTH is closed but the SPX engine window is still open — health treated those jobs as off-window, suppressing `market_hours_stale` and/or misclassifying them, which could surface as `query` watchdog problems for `spx-evaluate` and `spx-issues-sync`.

### Fix

`jobInMarketHoursSchedule()` uses `isSpxEngineCronWindow` for those two registry keys; other `market_hours_only` jobs keep `isEtCashRth`. Heartbeat `offWindow` branches for `zerodte-warm` and `spx-evaluate` use the same helper.
