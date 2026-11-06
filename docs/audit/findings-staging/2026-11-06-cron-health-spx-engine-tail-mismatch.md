## 2026-11-06 — [FINDING, cron audit] `spx-evaluate` / `spx-issues-sync` false stale via health-window mismatch — FIXED

> **kind:** `FINDING`

### Summary

| Field | Detail |
| --- | --- |
| **Symptom** | CI `query` / `scripts/cron-audit-query.mjs` watchdog listed `spx-evaluate` and `spx-issues-sync` in `problem_keys` (~16:05 ET Nov 6, 2026) despite routes still in `isSpxEngineCronWindow` (through 16:15 ET). |
| **Root cause** | `evaluateJob` treated all `market_hours_only` jobs as off-window when `!isEtCashRth` (cash session ends 16:00). SPX engine crons gate on `isSpxEngineCronWindow` (7:00–16:15 ET on trading days). In the post-close tail, last `skipped`/`ok` runs suppressed staleness incorrectly (or inverted expectations vs routes). |
| **Fix** | `inMarketHoursCronWindowForJob`: for `spx-evaluate` and `spx-issues-sync`, use `isSpxEngineCronWindow`; otherwise `isEtCashRth`. |
| **Tests** | `src/lib/admin-cron-health.test.ts` — post-16:00 ET trading-day assertions for SPX keys vs `flow-ingest` control. |
| **Status** | FIXED in PR (this branch). |
