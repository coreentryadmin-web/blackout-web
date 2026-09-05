# 2026-09-05 — Freshness tail guards + spx-evaluate UW sweep

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | SPX evaluate cron, VWAP proxy, signal log, 0DTE live marks, stock candle fallback, index change% |
| **Status** | FIXED |

## Symptom

1. `spx-evaluate` called `loadMergedSpxDesk()` without `runWithBackgroundUwSweep`, racing live member UW traffic on cold cache.
2. Four in-process caches used raw `Date.now() - fetchedAt`: SPY volume map (VWAP proxy), macro predictions (signal log), active-play set (live marks), Redis fallback refresh (stock candles). Future stamps pinned each indefinitely.
3. `computeSessionChangePct` returned `0` when `sessionOpen` was missing, fabricating a flat day instead of honest absence.

## Root cause

Hourly pattern scan §3 (2026-09-05 autonomous wake). Sibling freshness bugs were fixed in #3834–#3866 but these tail paths were missed.

## Fix

- Wrap `loadMergedSpxDesk()` in `runWithBackgroundUwSweep`.
- Route all four caches through `isWsUpdatedAtFresh`.
- `computeSessionChangePct` returns `null` without anchor; WS handlers preserve prior `change_pct`.

## Evidence

- `spx-evaluate/route.test.ts`, `spx-vwap-proxy-freshness.test.ts`, `spx-signal-log-macro-freshness.test.ts`, `live-marks-active-cache-freshness.test.ts`, `stock-candle-store-freshness.test.ts`, `polygon-socket-change-pct.test.ts`.

## RTH validation

- `spx-evaluate` cron completes without UW 429 storms when desk cache is cold.
- SPX pulse headline change% shows `—` not `0.00%` before REST anchor lands.
- Night Hawk open plays: active contract set refreshes within 10s after new commits.
