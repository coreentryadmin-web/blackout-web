# platform-warm cron burned UW on NYSE holidays — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-platform-warm-holiday-gate |
| **Priority** | P3 |
| **Area** | Cron infra / cache warmer |
| **Status** | FIXED |

## Symptom

`GET /api/cron/platform-warm` runs every 5 minutes 24/7 with no trading-calendar gate. On NYSE
holidays (e.g. Labor Day 2026-09-07) it still dispatched `loadBootstrapBundle()` — UW-bound work
against a closed tape while sibling warmers (desk/heatmap/zerodte/meridian) already gate via
`shouldRunCacheWarmer` → `isEtExtendedWarmHours` → `isTradingDayEt`.

## Root cause

Route header claimed "available 24/7" and skipped the shared cache-warmer gate entirely.

## Fix

`platform-warm/route.ts`: after auth, skip with `{ ok: true, status: "skipped", reason: "off-hours gate" }`
when `!shouldRunCacheWarmer(force, …)` unless `force=1` (ops/debug bypass — same as desk-warm).

## Blast radius

platform-warm cron only. Off-hours warm on real trading days (4 AM–8 PM ET extended window) unchanged.

## Evidence

RED→GREEN: `src/app/api/cron/platform-warm/route.test.ts` — static gate ordering assertion.
`npx tsx --test src/app/api/cron/platform-warm/route.test.ts` — pass.
