# Polygon market-status cache future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-market-status-cache |
| **Status** | FIXED |
| **Area** | providers/polygon.ts |
| **Severity** | P2 |

## Symptom

`fetchMarketStatusNow()` gated its 60s in-process cache with a raw `Date.now() - fetchedAt < MARKET_STATUS_CACHE_MS` check. A clock-skewed or future-stamped `fetchedAt` yields a negative age, which still satisfies `< 60_000`, so the cache reads as infinitely fresh until real time catches up — the same failure class fixed across UW/LULD halt gates and `fetchVixIvRankPercentile` in the same file.

## Fix

Route the cache hit through `isWsUpdatedAtFresh(marketStatusCache.fetchedAt, MARKET_STATUS_CACHE_MS, now)` so future stamps are rejected and a refetch is attempted.

## Evidence

- Source scan: `src/lib/providers/polygon-vix-cache-freshness.test.ts` (new assertion)
- `npx tsx --test src/lib/providers/polygon-vix-cache-freshness.test.ts`

## RTH validation

Off-hours only — confirm SPX desk market-phase chip still reflects open/closed after deploy; no user-visible number change expected.
