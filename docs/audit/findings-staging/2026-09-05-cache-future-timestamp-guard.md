# 2026-09-05 — GEX cross-validation + Largo desk cache future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | GEX cross-validation UW ladder cache, Largo SPX desk bundle cache |
| **Status** | FIXED |

## Symptom

Two in-process caches used raw `now - cachedAt < ttl` TTL checks. A clock-skewed future `cachedAt` reads as age 0 and passes indefinitely — the same false-fresh bug fixed across 40+ sites in the 2026-09-05 freshness sweep but missed here.

## Root cause

- `gex-cross-validation.ts` `getUwStrikeLadder` cached UW WS ladder with `Date.now() - entry.cachedAt < CACHE_TTL_MS`.
- `largo/spx-desk-cache.ts` `getLargoSpxLiveDesk` used `now - existing.cachedAt <= CACHE_TTL_MS`.

## Fix

Route both cache-hit gates through shared `isWsUpdatedAtFresh(cachedAt, ttlMs, now)`.

## Evidence

- Source-scan tests: `gex-cross-validation-cache-freshness.test.ts`, `spx-desk-cache-freshness.test.ts`.

## RTH validation

- Poll `/api/market/gex-heatmap?ticker=SPX` — `cross_validation` should refresh when UW WS reconnects (not stick on stale ladder).
- Largo SPX desk tool reads should reflect live pulse/GEX within 60s, not serve indefinitely stale bundle on cross-replica clock skew.
