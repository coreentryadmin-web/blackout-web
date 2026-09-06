# 2026-09-06 — Dead code: 9 Vector desk exports (zero real callers) — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P4 |
| **Area** | Vector desk |
| **PR** | (this branch) |

## Symptom

Found during a Vector-desk sweep for the same bug class as today's other fixes (population/
scope-mismatch correctness bugs) — Vector turned out to already be clean on that front (dense,
dated fix comments across `vector-regime.ts`/`vector-wall-proximity.ts`/
`vector-pick-effective-bias.ts` show it's had multiple prior correctness passes), but the same
sweep surfaced 9 dead exports confirmed via repo-wide grep (zero callers anywhere outside their
own definition, checked before and after removal):

1. `src/features/vector/lib/use-vector-live-poll.ts` — `useVectorLivePoll` (the file's only
   export; whole file deleted). Its own doc comment claimed it was the "single source" poll-cadence
   map for chart + shell, but neither actually imports it — `VectorChart.tsx` reads
   `VECTOR_GEX_HEATMAP_POLL_MS` directly and computes `scopePollMs` inline instead.
2. `src/features/vector/lib/vector-gex-heatmap-client.ts` — `fetchVectorGexHeatmapDeduped` +
   `_resetVectorGexHeatmapClientForTest` (both exports; whole file + its source-scan-only test
   deleted). Doc comment claimed "VectorPageShell's shift-leaders strip and VectorChart's
   background heatmap both hit this route" through the dedup wrapper, but both actually call
   `/api/market/vector/gex-heatmap` via a raw `fetch(...)` directly.
3. `src/features/vector/lib/vector-contract-picks.ts` — `legsForBias`, already marked
   `@deprecated` ("kept for minimal GET callers") with none left — same shape as today's other
   `@deprecated`-with-zero-callers fixes (`largoModuleStarterCards`, `learnIndexNowUrls`).
4. `src/features/vector/lib/vector-indicators-config.ts` — six unused type-guard functions
   (`isVectorStructureId`, `isVectorOscillatorId`, `isVectorConfluenceId`, `isVectorFlowId`,
   `isVectorExpectedMoveId`, `isVectorVolumeProfileId`), each sitting beside a used sibling
   (`isVectorOverlayId`, `isVectorLevelId`, etc.) that IS wired in. The underlying single-value
   union TYPES (`VectorStructureId` etc.) are genuinely used — composed into the real
   `VectorIndicatorId` union consumed elsewhere — so only the six unused runtime guard
   *functions* were removed; every type + its doc comment is untouched.
5. `src/features/vector/lib/vector-stream-hub.ts` — `vectorStreamConnectionCount` (an unused
   accessor beside the used `totalStreams` counter/`releaseVectorStreamConnection`).
6. Three test-only reset hooks with no caller, not even in their own module's test file:
   `vector-dte-walls-server.ts`'s `_resetPerExpiryWallsMemoForTest`,
   `vector-wall-persist.ts`'s `_resetWallRailMemoForTest`,
   `vector-shared-universe-cache.ts`'s `getSharedUniverseSetForTest` (its siblings
   `_setSharedUniverseForTest`/`_resetSharedUniverseCacheForTest` are real and untouched).

## Fix

Deleted each dead export; deleted the two whole files (`use-vector-live-poll.ts`,
`vector-gex-heatmap-client.ts` + its test) that had no surviving export at all. Every type
definition, doc comment, and still-used sibling function is untouched.

## Evidence

- `grep -rln "\b<symbol>\b"` for all 9 symbols before the fix: 1 file each (the definition).
- Same grep after the fix: 0 files, for all 9.
- `tsc --noEmit`: clean.
- Targeted tests (`vector-contract-picks`, `vector-indicators-config`, `vector-stream-hub`,
  `vector-dte-walls-server`, `vector-wall-persist`, `vector-shared-universe-cache`): 47/47 pass.
- Full `npm test` (Node 20): pending in this PR's evidence trail (see push).

## Blast radius

7 files, all Vector-desk-local: `use-vector-live-poll.ts` (deleted), `vector-gex-heatmap-client.ts`
+ `.test.ts` (deleted), `vector-contract-picks.ts`, `vector-indicators-config.ts`,
`vector-stream-hub.ts`, `vector-dte-walls-server.ts`, `vector-wall-persist.ts`,
`vector-shared-universe-cache.ts`. No live rendering/data path changed — every removed export was
confirmed to have no caller before removal.
