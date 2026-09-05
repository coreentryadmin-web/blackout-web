> **kind:** FINDING

# GEX cross-validation + Polygon market-status caches — future-at guard — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | `gex-cross-validation.ts` REST ladder cache, `polygon.ts` `fetchMarketStatusNow` |

## Symptom

Pattern scan (`blackout:hourly` §3) found two remaining `Date.now() - cachedAt < ttl` gates without
`isWsUpdatedAtFresh` — same clock-skew false-fresh class fixed across #3834/#3844–#3849.

## Root cause

A future-dated `cachedAt`/`fetchedAt` (cross-replica ECS clock skew) reads as negative age, which
always satisfies `< ttlMs`, so stale entries serve indefinitely.

## Fix

- `getUwStrikeLadder`: `isWsUpdatedAtFresh(entry.cachedAt, CACHE_TTL_MS, now)`
- `fetchMarketStatusNow`: `isWsUpdatedAtFresh(marketStatusCache.fetchedAt, MARKET_STATUS_CACHE_MS, now)`

## Evidence

- Source-scan tests: `gex-cross-validation-freshness.test.ts`, `polygon-vix-cache-freshness.test.ts`
  (market-status case). RED pre-fix via `git stash`, GREEN post-fix.

## RTH validation

- Thermal/SPX matrix `cross_validation` still populates when UW ladder is live (no behavior change
  on healthy clocks).
- Vector pulse / regime surfaces using `fetchMarketStatusNow` should still show correct RTH/closed
  state — verify admin System Vitals market phase during open.
