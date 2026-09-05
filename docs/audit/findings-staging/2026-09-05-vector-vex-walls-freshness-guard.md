# 2026-09-05 — Vector VEX walls memo used raw age math (future-stamp false-fresh)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Vector snapshot / VEX walls cache |
| **Status** | FIXED |

## Symptom

`getVectorVexWalls()` memoized with `now - cachedVexWallsAt < VEX_WALLS_CACHE_MS` while sibling `getVectorGexWalls()` and `wallScope` TTL already used `isWsUpdatedAtFresh`. A clock-skewed future `cachedVexWallsAt` (negative age) read as infinitely fresh — same failure class fixed across UW halt gates, SPX pulse, and gamma-wall memo in prior sweeps.

## Root cause

VEX-wall path was missed when `vector-snapshot-wallscope-freshness.test.ts` was added for gamma walls + wallScope only.

## Fix

Replace raw subtraction with `isWsUpdatedAtFresh(s.cachedVexWallsAt, VEX_WALLS_CACHE_MS, now)`; extend source-scan test.

## Evidence

- `vector-snapshot-wallscope-freshness.test.ts` — RED pre-fix on `cachedVexWallsAt` assertion, GREEN post-fix.
- Pattern scan from hourly checklist §3 (Date.now() − timestamp without future guard).

## RTH validation

- Vector desk VEX lens: toggle GEX/VEX on SPX — walls refresh normally; no stuck vanna walls after a tab sleep/reconnect.
- `GET /api/market/vector/walls?ticker=SPX` — `vex` payload present and updates within cache TTL during RTH.
