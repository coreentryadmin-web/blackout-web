# GEX cross-validation in-process cache — future timestamp false-fresh

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-gex-cv-fresh |
| **Status** | FIXED |
| **Area** | Thermal GEX cross_validation |
| **Severity** | HIGH |

## Symptom

`getUwStrikeLadder` used raw `Date.now() - entry.cachedAt < CACHE_TTL_MS`. A clock-skewed or future `cachedAt` (from WS `updatedAt`) yields negative age → always passes TTL → stale UW ladder served as fresh on Thermal `cross_validation`.

## Fix

Use `isWsUpdatedAtFresh(entry.cachedAt, CACHE_TTL_MS)` — same guard as SPX VWAP proxy, stock candles, UW caches.

## Verify

- `npx tsx --test src/lib/providers/gex-cross-validation-freshness.test.ts`
- RTH: Thermal SPX matrix `cross_validation` block shows honest `uw_asof` after WS reconnect
