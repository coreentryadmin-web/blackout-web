> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | RTH deep audit RED: GEX cold + swing-discovery watchdog |
| **Status** | FIXED |

## What broke

Run **42897223779** (Tue 15:38 ET): P0 `getGexPositioning` SPX/SPY cold; cron-watchdog `swing-discovery`; data-integrity discrepancies.

## Fix

`gha-rth-audit`: pre-dispatch `heatmap-warm` + `desk-warm` before deep audit in cash RTH. `swingDiscoveryAwaitingPhaseSuppress`: only OVERNIGHT requires POST_CLOSE done — POWER_HOUR/MIDDAY/PRE_OPEN suppress stale inside their window.

## Verify

`npx tsx --test src/lib/swing/discovery-cron-health.test.ts scripts/lib/rth-audit-cache-warm.test.ts`
