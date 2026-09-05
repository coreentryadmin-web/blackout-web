# Vector flip/dark-pool cache future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-0104 |
| **Status** | FIXED |
| **Area** | Vector snapshot hub |
| **Severity** | P2 |

## Symptom

`vector-snapshot.ts` used raw `Date.now() - cachedFlipAt` / `cachedDarkPoolAt` for TTL gates. A future `cachedAt` (clock skew) yields negative age, which fails `>= FLIP_CACHE_MS` and **suppresses background refresh** — stale flip/dark-pool data served indefinitely.

## Root cause

Lines 446, 677, 686 compared wall-clock delta without `isWsUpdatedAtFresh()` future-tolerance handling (same class fixed for `wallScope` / `cachedWallsAt` in #3885 wave).

## Fix

Route all three gates through `isWsUpdatedAtFresh()` from `@/lib/ws/timestamp-freshness`.

## Evidence

Regression tests in `vector-snapshot-wallscope-freshness.test.ts` — RED pre-fix (raw `Date.now() - cached*`), GREEN post-fix.
