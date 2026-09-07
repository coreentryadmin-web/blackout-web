# legacy-live-sync runs on market holidays despite `market_hours_only: true` — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-legacy-live-sync-holiday-gate |
| **Priority** | P3 |
| **Area** | Cron infra / Polygon rate budget |
| **Status** | FIXED |

## Symptom

During the Labor Day 2026-09-07 holiday sweep (same class as #4482/#4483/#4484), `legacy-live-sync`
was identified as one of the remaining `market_hours_only: true` crons with no route-level
`isEtCashRth()` execution gate. On a closed market it would still fetch Polygon stock snapshots and
option marks for open Legacy playbook rows.

## Root cause

`legacy-live-sync` is registered `market_hours_only: true` in `cron-registry.ts`, but its `GET`
handler went straight from `isCronAuthorized` into `runLegacyLiveSync` with no trading-day check.
EventBridge's fixed-UTC weekday schedule has no holiday calendar (ET-INTENT bug class).

## Fix

Added `isEtCashRth()` gate after auth, before any Polygon/UW work — same skip payload shape as
`banger-live-sync` (#4484) and `uw-cache-refresh` (#4482).

## Evidence

RED→GREEN: new static-source test in `route.test.ts`. `npx tsx --test` on the file — 1/1 pass.
