# 2026-09-05 — spx-evaluate UW sweep + freshness future-guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | SPX evaluate cron, lit/dark ratio, Polygon market status cache, SPY VWAP proxy, index change% |
| **Status** | FIXED |

## Symptom

1. `spx-evaluate` called `loadMergedSpxDesk()` bare — on cache miss it fans out many `fetchUw*` calls and races live member traffic for the cluster-wide 2 RPS UW budget.
2. `computeLitDarkRatio`, `fetchMarketStatusNow` cache, and SPY volume proxy cache used raw `Date.now() - fetchedAt` — clock-skewed future timestamps read as infinitely fresh.
3. `computeSessionChangePct` returned `0` when `sessionOpen` was missing, fabricating a flat day instead of honest absence.

## Root cause

Hourly pattern scan §3 (2026-09-05 autonomous wake). `spx-evaluate` was the only UW-heavy cron path still missing `runWithBackgroundUwSweep`; sibling freshness bugs reused pre-#3834 raw-age math.

## Fix

- Wrap `loadMergedSpxDesk()` in `runWithBackgroundUwSweep`.
- Route lit/dark, market-status, and SPY-volume caches through `isWsUpdatedAtFresh`.
- `computeSessionChangePct` returns `null` without a session anchor; WS handlers preserve prior `change_pct`.

## Evidence

- `spx-evaluate/route.test.ts`, `uw-lit-dark-ratio-freshness.test.ts`, `polygon-socket-change-pct.test.ts`, `spx-vwap-proxy.test.ts` (future-skew cache test).

## RTH validation

- During RTH, confirm `spx-evaluate` cron completes without UW 429 storms in CloudWatch when desk cache is cold.
- SPX desk `lit_dark_ratio` absent (not stale-positive) when UW WS stores carry future `updatedAt`.
- `/api/market/spx/pulse` headline change% shows `—` not `0.00%` before REST anchor lands.
