> **kind:** FINDING

# validate-deploy off-hours desk-warm force=1 storm — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 (performance / unnecessary prod load) |

## Symptom

Saturday 2026-09-05: 77 `desk-warm` completions in 4h from 54 distinct `force=1` caller IPs (all `node` UA), driving ALB p99 4–9s despite p50 ~30ms.

## Root cause

`scripts/validate-deploy.mjs` unconditionally called `/api/cron/desk-warm?force=1` on every post-deploy validation. Each autopilot agent session runs this — the fleet collectively re-armed desk-warm continuously outside extended warm hours.

## Fix

Gate the warm step behind `isEtExtendedWarmHours()` — same window cache-warmer crons use. Off-hours/weekend deploy validation still runs HTTP smoke; cache warm is skipped with an explicit warning.

## Regression test

`src/validate-deploy-warm-gate.test.ts`
