# Vector snapshot wallScope — future fetchedAt guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Vector in-process wallScope refresh (`vector-snapshot.ts`) |

## What was broken

`refreshWallScope` and `primeVectorWallScope` gated on raw `now - wallScope.fetchedAt < refreshMs`. A clock-skewed future stamp reads as negative age → treated as "just fetched" → heatmap scope stops refreshing for the rest of the skew window.

## What changed

Both gates now use shared `isWsUpdatedAtFresh(wallScope.fetchedAt, refreshMs, now)`.

## RTH validation

- Vector GEX/VEX wall rail on SPX/SPY should continue refreshing on cadence during RTH.
- Cold SSR prime (`primeVectorWallScope`) should still populate walls on first paint when cache empty.
