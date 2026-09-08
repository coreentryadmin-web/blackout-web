# flow-ingest runs on market holidays despite `market_hours_only: true` — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-flow-ingest-holiday-gate |
| **Priority** | P3 |
| **Area** | Cron infra / UW rate-limit budget / HELIX feed |
| **Status** | FIXED |

## Symptom

Discovered during post-#4482 audit sweep of all `market_hours_only: true` crons. On Labor Day
2026-09-07 (weekday market holiday), `flow-ingest` continued polling UW `flow_alerts` REST on
the same ~2 min EventBridge cadence as a normal RTH session — burning rate-capped UW quota and
writing nothing members would see (market closed, no new prints to ingest).

## Root cause

`flow-ingest` is registered `market_hours_only: true` in `cron-registry.ts` with schedule label
"~Every 2 min (market hours)", but the route had **no trading-calendar execution gate** — only
auth + `ingestInFlight` dedup. EventBridge fires on fixed UTC weekdays regardless of NYSE holidays
(same ET-INTENT bug class documented in `cron-dst-audit.mjs` and fixed for `uw-cache-refresh` in
#4482).

## Fix

Added `isEtCashRth()` gate immediately after auth and before any ingest work, returning
`{ ok: true, skipped: true, reason: "outside RTH (weekend/holiday/off-hours)" }` — matching
#4482's skip payload shape.

## Blast radius

Single route. RTH behavior unchanged: background-sweep-tagged `runFlowIngest()` + flows cache
warm still run during cash session. Off-hours/holiday HELIX reads already served from persisted
rows + last warm — this only stops wasted UW polling.

## Evidence

RED→GREEN: new static test in `route.test.ts` — fails pre-fix (no `isEtCashRth` import/gate),
passes post-fix. `npx tsx --test src/app/api/cron/flow-ingest/route.test.ts` — 3/3 pass.
