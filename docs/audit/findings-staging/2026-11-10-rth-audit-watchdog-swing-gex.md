> **kind:** FINDING

## RTH deep audit RED at 15:38 ET — watchdog + swing POWER_HOUR + GEX flake

| **Status** | FIXED (this PR) |
|------------|-----------------|
| **Run** | `42897223779` on `main@0ba38002` |
| **Failures** | `cron-watchdog: swing-discovery`; `data-integrity` GEX cold SPX/SPY; full-site P0 cross-tool |
| **Root cause** | `evaluateCronWatchdogAudit` regressed to fail all `problem_keys` in RTH (FINDINGS #7864 intended rth_stale only); `swingDiscoveryAwaitingPhaseSuppress` required POST_CLOSE before intraday phases; brief matrix miss during Polygon circuit |
| **Fix** | Restore shouldFail=rth_stale+critical; intraday phase suppress; 4s GEX positioning retry in `runDataIntegrityChecks` |
