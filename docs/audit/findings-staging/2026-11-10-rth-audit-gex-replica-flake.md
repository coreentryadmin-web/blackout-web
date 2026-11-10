# RTH deep audit RED — GEX cold + swing-discovery during POWER_HOUR — FIXED

> **kind:** FINDING

| **Status** | FIXED |

## What broke

`audit` on `main@0ba38002` (run `42897223779`, Tue 15:38 ET): P0 `getGexPositioning` cold for SPX/SPY while heatmap matrix audit passed spot 7526.9; `data-integrity` discrepancies; `cron-watchdog` flagged `swing-discovery` during POWER_HOUR.

## Root cause

1. **GEX:** `runDataIntegrityChecks` read `getGexPositioning` once on whichever ECS task served the cron — transient Redis miss while another replica still served live matrices via `/api/market/gex-heatmap`.
2. **Swing-discovery:** `swingDiscoveryAwaitingPhaseSuppress` only covered POST_CLOSE→next-phase gaps, not an active intraday phase window (POWER_HOUR) before the idempotent claim logged.

## Fix

- Retry `getGexPositioning` (3×, 400ms) in `data-integrity-checks.ts`.
- Full-site + `gha-rth-audit`: confirm GEX-cold-only discrepancies via heatmap API or one retry.
- Extend phase-awaiting suppress for any active `resolveScanPhase` window.

## Verify

`npx tsx --test src/lib/swing/discovery-cron-health.test.ts`  
`node --test scripts/full-site-deep-audit.test.mjs`
