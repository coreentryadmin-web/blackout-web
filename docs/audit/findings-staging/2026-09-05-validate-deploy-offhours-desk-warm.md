# 2026-09-05 — validate-deploy off-hours desk-warm force storm

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | deploy / performance |
| **PR** | (this branch) |

## Symptom

Live ALB p99/Max tail latency on a **Saturday** (market closed): 77 `desk-warm` completions in 4h, all via `?force=1` from 54 distinct source IPs. EventBridge and rth-warm-leader were silent — external CRON_SECRET holders were the callers.

## Root cause

`scripts/validate-deploy.mjs` unconditionally POSTed `/api/cron/desk-warm?force=1` on every run when `CRON_SECRET` is set. Cloud Agent sessions run `validate:deploy` frequently off-hours, bypassing the server-side extended-warm hours gate.

## Fix

Added `scripts/lib/cache-warm-deploy-gate.mjs` (`isDeployCacheWarmAllowed`) mirroring the weekday 4 AM–8 PM ET window. `validate-deploy` skips force=1 warmers outside that window with an explicit warn line.

## Evidence

- `scripts/lib/cache-warm-deploy-gate.test.mjs` — 5/5 pass (includes Saturday 2026-09-05 rejection).
- Related observability finding (write-up only): PR #4013.

## Blast radius

Deploy validation only — no runtime product path. On weekdays inside the warm window, behavior unchanged.

## Market-open validation

Monday pre-open: confirm a single `validate:deploy` during 4–8 PM ET window still logs `desk-warm → ok`.
