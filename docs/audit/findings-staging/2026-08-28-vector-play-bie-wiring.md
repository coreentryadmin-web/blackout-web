> **kind:** `FINDING`

## Vector play engine — BIE wiring, server staleness, pool exhaustion refetch

| **Status** | FIXED |

Three gaps from the 2026-08-27 play-engine audit remained after the backfill/contextKey merges:

1. **PlayBieContext was fully built in the engine but never populated in production.** Added
   `vectorPlayBieBucketKey()` + `vector-play-bie-stats.ts` aggregation (n≥10 from
   `vector_pick_closures`), server resolver `resolveVectorPlayBieContext()`, tier-gated
   `POST /api/market/vector/play-bie`, wiring in `vector-full-state.ts` and `VectorChart.tsx`
   emitPlay, and `bie_bucket` persistence on closure rows.

2. **Server-built plays ignored cache age for conviction.** `withReadContext()` now rebuilds
   `buildVectorPlay()` with read-time `dataAgeMs = now - asOf` so Largo/BIE conviction staleness
   matches the chart card. BIE full-state compute also uses proximity hysteresis via cached
   `prev` on rebuild.

3. **All 8 pool picks invalidating left the active strip empty until the 45s refresh.** When every
   ranked OCC is excluded, `useVectorActionablePicks` triggers one immediate pool refetch (deduped
   by signature) via `refetchToken` on `useVectorContractPicks`.

**Evidence:** `npx tsx --test src/features/vector/lib/vector-play-engine.test.ts`,
`vector-play-bie-stats.test.ts`, full vector play/pick suite; `npx tsc --noEmit` clean.

**Honest limit:** BIE samples come from Don't buy closure rows only until a positive-outcome cron
exists — fav rates are conservative by construction, not fabricated.
