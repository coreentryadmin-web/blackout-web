# Audit RTH false P0 — GEX cold on data-integrity + swing-discovery watchdog

> **kind:** FINDING

## Symptom

`audit` workflow run `42897223779` on `main@0ba38002` during RTH failed:

1. `full-site-deep-audit` P0 `integrity/cross-tool` — C6 flagged SPX/SPY matrix cold.
2. `data-integrity: discrepancies` — same C6 titles.
3. `cron-watchdog: swing-discovery` — `problem_keys` without `market_hours_stale`.

Parallel heatmap HTTP checks in the same run were GREEN (SPX desk spot live).

## Root cause

1. **C6:** `runDataIntegrityChecks` used `getGexPositioning` only. On a cold replica the normal `fetchGexHeatmap` block cap can hand off null while other replicas serve warm matrices via HTTP.
2. **Watchdog:** `evaluateCronWatchdogAudit` failed on any `problem_keys` during RTH; ops-collect only pages `rth_stale_keys`. Phase-anchored `swing-discovery` handshake lag is a warn, not a deploy gate.

## Fix

| **Status** | FIXED |
|------------|-------|
| **PR** | (this branch) |

- `gexPositioningForIntegrityCheck` — one bounded `forceRefresh` rebuild before C6 cold flag.
- `watchdog-audit-eval.mjs` — RTH fail only on `rth_stale_keys` + critical error spike.

## Verify (next RTH)

- `GET /api/cron/data-integrity?force=1` during RTH → 0 discrepancies when heatmaps are warm.
- `gha-rth-audit` cron-watchdog green when only off-window cron handshake problems exist.
