## 2026-11-06 — [FINDING, cron health, SPX engine crons]

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **What broke** | `market_hours_only` cron health used cash RTH (`isEtCashRth`, 9:30–16:00 ET) for off-window suppression, while `spx-evaluate`, `spx-issues-sync`, `data-integrity`, and sibling routes gate execution with `isSpxEngineCronWindow` (7:00–16:15 ET on trading days). In premarket and for a few minutes after cash close, healthy skips suppressed staleness the cron watchdog still expected activity, producing false `problem_keys` (e.g. `spx-evaluate`, `spx-issues-sync`) and failing the `query` / cron-audit workflow. |
| **Root cause** | Semantic mismatch: registry + health “market hours” != route “SPX engine window”. |
| **Fix** | `spx_engine_cron_window` on affected registry entries; `cronMarketHoursInWindow()` in `admin-cron-health.ts` uses `isSpxEngineCronWindow` for those jobs; `spx-evaluate` heartbeat cross-check uses the same window. |
| **Status** | FIXED (this PR) |
