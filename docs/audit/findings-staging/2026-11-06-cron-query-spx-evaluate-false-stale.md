> **kind:** `FINDING`

## 2026-11-06 — `query` CI: `spx-evaluate` + `spx-issues-sync` false stale (premarket vs cash RTH gate) — FIXED

| **Status** | Fixed on `main` (`marketHoursCronInSession` + SPX heartbeat override) |
|------------|-------------------|
| **Symptom** | `Cron audit query` on `main` (run **42265738332**, `47392f2c`) failed: `problems: spx-evaluate, spx-issues-sync` via HTTP watchdog. |
| **Root cause** | `evaluateJob` treated `market_hours_only` as `isEtCashRth` (9:30–close). `spx-evaluate` / `spx-issues-sync` routes gate on **`isSpxEngineCronWindow`** (7:00–16:15 ET). 7:00–9:30 AM ET `cron_job_runs` skips accumulated age until handshake looked stale while the play engine was still ticking. Heartbeat override only applied to `spx-evaluate`, not `spx-issues-sync`. |
| **Fix** | `marketHoursCronInSession()` uses `isSpxEngineCronWindow` for SPX-engine-gated crons; extend heartbeat reconciliation to `spx-issues-sync`; trust fresh HB over stale handshake when HB is not stale. |
| **Verify** | `npx tsx --test src/lib/admin-cron-health.test.ts`; next hourly `query` during premarket should stay GREEN if the engine is healthy. |
