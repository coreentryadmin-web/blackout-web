> **kind:** FINDING

## RTH deep audit: swing-discovery P1 failed GHA + GEX cold retry — FIXED (harness)

| **Status** | Fixed in branch |
| --- | --- |

**Run:** `42897223779` @ `0ba38002`, Tue 15:38 ET — failed `audit` with GEX cold P0 + `cron-watchdog: swing-discovery` + `data-integrity`.

**Root causes:**
1. `evaluateCronWatchdogAudit` failed the run on any `problem_keys` during RTH; ops-collect treats those as P1 (only `rth_stale_keys` is P0).
2. Transient empty heatmap cache could trip C6 on first `getGexPositioning` read during deploy/warm overlap.

**Fix:** Align watchdog eval with ops P0/P1; brief RTH retry (3×400ms) before C6 cold flag.

**Residual:** A sustained cold SPX/SPY matrix during RTH still fails data-integrity — correct.
