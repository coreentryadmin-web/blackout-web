> **kind:** FINDING

## Vector wallScope cache: future `fetchedAt` pins stale GEX walls

| **Status** | FIXED (pending merge) |

**What was broken:** `vector-snapshot.ts` gated `refreshWallScope` / `primeVectorWallScope` on `now - wallScope.fetchedAt < refreshMs`. A clock-skewed future stamp reads as age 0 and blocks heatmap refetches indefinitely — same class as #3853–#3872 freshness sweep.

**Fix:** Route both gates through shared `isWsUpdatedAtFresh`.

**RTH check:** Open Vector GEX lens on a preset ticker during RTH; confirm wall nodes refresh within `VECTOR_WALL_SCOPE_REFRESH_MS` after a forced matrix turnover (no stuck SYNCING walls from a pinned scope cache).
