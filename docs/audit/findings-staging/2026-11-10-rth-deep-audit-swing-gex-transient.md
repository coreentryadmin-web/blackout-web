# RTH deep audit RED — swing-discovery + transient GEX cold — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |

## Symptom

`RTH deep audit` run **42897223779** (`main@0ba380023`, 2026-11-10 20:38 UTC / ~3:38 PM ET) failed on:

- Full-site: P0 data-integrity `getGexPositioning` cold while `gex-heatmap` matrix was live; P1 swing-discovery watchdog flag
- `gha-rth-audit`: `data-integrity` discrepancies + `cron-watchdog: problems: swing-discovery`

## Root cause

1. **Watchdog CI gating** still treated any in-RTH `problem_keys` entry as hard-fail, while `ops-collect` only pages P0 on `rth_stale_keys` (non-RTH-stale problems are P1).
2. **Phase-anchored swing-discovery** before POST_CLOSE: `swingDiscoveryAwaitingPhaseSuppress` required POST_CLOSE `done`, so POWER_HOUR handshake lag stayed red despite a fresh serving snapshot.
3. **Data-integrity GEX cold** can be a transient `getGexPositioning` miss in the same run where authenticated `gex-heatmap` reads are warm (Polygon circuit pressure).

## Fix

- `evaluateCronWatchdogAudit`: fail only on `rth_stale_keys` + critical `error_spike`.
- Pre-POST_CLOSE phase await suppress when serving snapshot probe is fresh.
- Full-site: reconcile GEX cold issues against live `gex-heatmap`; `gha-rth-audit` retries data-integrity once after 15s during RTH.

## Verify

`npx tsx --test scripts/audit/lib/watchdog-audit-eval.test.ts scripts/audit/lib/data-integrity-audit-reconcile.test.ts src/lib/swing/discovery-cron-health.test.ts`
