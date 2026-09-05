# Vector snapshot flip/dark-pool cache future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards / Vector |

## Symptom

`vector-snapshot.ts` already guarded `wallScope` and `cachedWallsAt` via `isWsUpdatedAtFresh`, but
`cachedFlipAt` and `cachedDarkPoolAt` still used raw `Date.now() - at` arithmetic. A far-future stamp
pins flip/dark-pool refresh off indefinitely (negative age never satisfies `>= TTL`).

## Fix

Route `getVectorGammaFlip` memo + hub tick SWR refresh triggers through `isWsUpdatedAtFresh`.

## Evidence

- `src/features/vector/lib/vector-snapshot-wallscope-freshness.test.ts` — extended flip/dark-pool cases
