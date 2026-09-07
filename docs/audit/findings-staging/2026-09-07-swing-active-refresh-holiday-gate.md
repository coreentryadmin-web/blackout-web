# swing-active-refresh runs on market holidays despite `market_hours_only: true` — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P3-swing-active-refresh-holiday-gate |
| **Priority** | P3 |
| **Area** | Cron infra / UW rate-limit budget / Swing position marks |
| **Status** | FIXED |

## Symptom

Post-#4482 audit sweep of `market_hours_only: true` crons. On Labor Day 2026-09-07, `swing-active-refresh`
continued dispatching per-position Polygon/UW reads every 15 min while the market was closed — burning
rate-capped upstream quota with no member-visible benefit.

## Root cause

`swing-active-refresh` is registered `market_hours_only: true` in `cron-registry.ts` but the route had
only auth + singleton claim — no trading-calendar execution gate. EventBridge fires on fixed UTC weekdays
regardless of NYSE holidays (same ET-INTENT class as `flow-ingest` / `uw-cache-refresh`).

## Fix

Added `isEtCashRth()` gate immediately after auth and before `after(dispatchRefresh)`, returning
`{ ok: true, skipped: true, reason: "outside RTH (weekend/holiday/off-hours)" }` — matching #4482/#4483.

## Blast radius

Single route. RTH behavior unchanged: background `runSwingActiveRefreshCron` still runs during cash session.

## Evidence

RED→GREEN: static test in `route.test.ts` — fails pre-fix, passes post-fix.
`npx tsx --test src/app/api/cron/swing-active-refresh/route.test.ts` — 4/4 pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
