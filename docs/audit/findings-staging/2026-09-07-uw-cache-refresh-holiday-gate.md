# uw-cache-refresh runs unconditionally on market holidays despite `market_hours_only: true` — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-uw-cache-refresh-holiday-gate |
| **Priority** | P3 |
| **Area** | Cron infra / UW rate-limit budget |
| **Status** | FIXED |

## Symptom

Found during the standing performance/latency audit mandate, live on Labor Day 2026-09-07 (a
market holiday falling on a weekday). CloudWatch `elapsed=` logs showed `[cron/uw-cache-refresh]`
firing **44 times in a 90-minute window** while the 0DTE board reported `trading_day: false` /
`heat.state: "CLOSED"` — the market was closed the entire time.

## Root cause

`uw-cache-refresh` is registered in `cron-registry.ts` with `market_hours_only: true`, and its
description says it exists "to stay under 120/min plan cap" — a rate-sensitive job that should only
run when the data matters. The deployed EventBridge rule
(`blackout-production-uw-cache-refresh`, `cron(*/2 11-21 ? * MON-FRI *)`) is a **fixed-UTC
weekday/hour window with no holiday calendar** — it fires on any weekday inside 11:00-21:59 UTC
regardless of whether that weekday is an actual trading session. That alone would be tolerable if
the route self-skipped on non-trading days (the same pattern `desk-warm`/`zerodte-warm` use via
`shouldRunCacheWarmer`), but `uw-cache-refresh`'s `GET` handler had **zero hours/trading-day
check** — it went straight from `isCronAuthorized` into the full Redis + UW/Polygon fan-out
(market tide, 5 sector tides, dark pool ×2, top-net-impact, congress trades, net-prem-ticks ×3,
NOPE ×3, flow-per-strike ×2, market movers — ~13+ upstream calls per run).

`admin-cron-health.ts` already treats this job as correctly off-window during a holiday (its
`inMarketHoursEt` helper is `isEtCashRth`, which is holiday-aware via `isTradingDayEt`) — so the
health dashboard shows no alert. But that's a *staleness-suppression* read, not an *execution*
gate: the registry's declared intent (`market_hours_only: true`) and the route's actual behavior
had quietly diverged. This is a variant of the `cron-dst-audit.mjs` "ET-INTENT" bug class already
documented in this repo (a job that still RUNS on the wrong side of the event it's scheduled
around, emitting output that looks valid) — except here the mismatch is a full trading-calendar
holiday, not a DST offset.

## Fix

Added the same holiday-aware, RTH-scoped gate other market-hours crons already use —
`isEtCashRth()` (`et-market-hours.ts`, already checks weekday + `isTradingDayEt` + 9:30-16:00 ET /
early-close) — at the top of `GET`, right after the auth check and before any Redis/UW work. A
non-RTH request now returns `{ ok: true, skipped: true, reason: "outside RTH (weekend/holiday/off-hours)" }`
instead of running the fan-out, matching the skip-payload shape `desk-warm`/`platform-warm` already
use.

## Blast radius

Single route: `src/app/api/cron/uw-cache-refresh/route.ts`. No consumer of the Redis keys this cron
warms is affected during RTH (the only window it now still runs in, unchanged from before) — the
WS-store seeding (`seedUwCacheFromWsStores`) and pulse-snapshot seeding remain untouched for that
window. Off-hours/holiday reads of these same Redis keys were already served from whatever the
last real RTH warm left behind (TTL-bounded), same as before this fix — this only stops the
WASTED re-fetch, it doesn't change what members see.

## Evidence

RED→GREEN: new test `uw-cache-refresh gates on isEtCashRth (holiday-aware) before the redis/UW
fan-out` in `route.test.ts` (static-source-inspection style, matching this file's existing test
convention) — fails pre-fix (no `isEtCashRth` import/gate), passes post-fix. `git stash` on
`route.ts` alone confirmed 1/3 failing pre-fix, 3/3 passing post-fix. `npx tsc --noEmit` — clean.

Live measurement that motivated the fix: 44 `[cron/uw-cache-refresh]` completions in a 90-minute
window (2026-09-07, ~11:00-13:35 UTC) on a confirmed-closed market (`GET /api/market/zerodte/board`
returned `session.trading_day: false`, `heat.state: "CLOSED"` in the same window).
