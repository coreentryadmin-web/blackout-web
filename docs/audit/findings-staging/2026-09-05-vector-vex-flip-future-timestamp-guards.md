# 2026-09-05 — vector vex-wall + gamma-flip future-timestamp freshness guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Cache TTL / clock-skew |

## Symptom

Sibling paths in `vector-snapshot.ts` to #3885 still used naive `now - cachedAt < TTL` for `cachedVexWallsAt` and `cachedFlipAt`. Future-dated stamps read as infinitely fresh. Background flip refresh used `Date.now() - cachedFlipAt >= FLIP_CACHE_MS`, which also misbehaves under clock skew.

## Fix

Use shared `isWsUpdatedAtFresh()` at vex-wall memo, gamma-flip memo, and hub background flip refresh gate.

## Verify

- `npx tsx --test src/features/vector/lib/vector-snapshot-wallscope-freshness.test.ts`
