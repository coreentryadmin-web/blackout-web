# SPX desk UW REST supplemental + flow lane missing background sweep tag

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-spx-desk-uw-sweep-rest-flow |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | SPX desk / UW rate limiter |
| **PR** | (this branch) |

## Symptom

Hourly pattern scan (#3) found two SPX desk cold paths still calling `runUwPooled` without
`runWithBackgroundUwSweep`:

- `fetchUwDeskRestSupplemental()` — NOPE / max pain / IV on cache miss
- `buildSpxDeskFlow()` — 6-endpoint UW fan-out (dark pool, 0DTE flow, greek expiry, etc.)

`fetchDeskEnrichmentFields` was already wrapped (2026-09-05 earlier fix); these siblings were not.

## Reachability

Both run from cron-triggered desk rebuilds:

- `spx-evaluate`, `spx-signal-observe`, `market-regime-detector` via `loadMergedSpxDesk()`

Unlike `desk-warm` (route-level sweep tag), these crons could consume UW concurrency reserved for
live member traffic (~2 RPS cluster-wide).

## Fix

Wrap both UW blocks in `runWithBackgroundUwSweep`. Extend `spx-desk-enrichment-uw-sweep.test.ts`
with static assertions for all three paths.

## Evidence

- Pattern scan 2026-09-05 Autopilot hourly wake
- Tests: `npx tsx --test src/features/spx/lib/spx-desk-enrichment-uw-sweep.test.ts`
