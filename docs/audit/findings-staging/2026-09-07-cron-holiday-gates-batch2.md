# Three market_hours_only crons still polled upstream on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-cron-holiday-gates-batch2 |
| **Priority** | P3 |
| **Area** | Cron infra / UW+Polygon rate budget |
| **Status** | FIXED |

## Symptom

Post-#4482/#4483 audit sweep of remaining `market_hours_only: true` crons. On Labor Day
2026-09-07, three routes still executed real upstream work on EventBridge's weekday schedule:

- `swing-active-refresh` — Polygon option snapshots + UW IV rank per open swing position
- `banger-live-sync` — Polygon unified option snapshot marks for open banger positions
- `helix-signal-outcomes` — DB record/grade churn with no live tape to grade against

## Root cause

Same ET-INTENT class as `uw-cache-refresh` (#4482) and `flow-ingest` (#4483): registry declares
`market_hours_only: true` but routes had no `isEtCashRth()` execution gate.

## Fix

Added holiday-aware RTH gate after auth (and after `requireDatabaseInProduction` where applicable),
returning `{ ok: true, skipped: true, reason: "outside RTH (weekend/holiday/off-hours)" }`.

## Blast radius

Three routes only. RTH behavior unchanged. Remaining ungated `market_hours_only` crons documented
for follow-up: `socket-health` (partial gate), `gex-alerts`/`vector-alerts` (push kill-switch),
`legacy-live-sync`.

## Evidence

RED→GREEN static tests in each route's `route.test.ts`. All pass:
`npx tsx --test src/app/api/cron/swing-active-refresh/route.test.ts`
`npx tsx --test src/app/api/cron/banger-live-sync/route.test.ts`
`npx tsx --test src/app/api/cron/helix-signal-outcomes/route.test.ts`
