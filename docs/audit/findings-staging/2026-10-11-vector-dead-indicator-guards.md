## Vector `vector-indicators-config.ts` — 7 more type-guard predicates went dead since the last audit — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/vector-dead-indicator-guards) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `isVectorOverlayId`, `isVectorOpeningRangeMinutes`, `isVectorLevelId`,
`isVectorExpectedMoveConeId`, `isVectorGexHeatmapId`, `isVectorGammaRegimeId`, and
`isVectorBeadDisplayId` were each a runtime type-guard beside their id union type. The only real
consumer of these ids, `VectorIndicatorMenu.tsx`, builds its menu straight off the registry data
(`VECTOR_INDICATOR_GROUPS`) and only calls ONE guard — `isVectorOverlayFamilyId` — to decide whether
to run the moving-average bar-count availability check; every other item type (levels, structure,
oscillators, confluence, flow, expected-move(-cone), gex-heatmap, gamma-regime, volume-profile,
bead-display) renders generically with no per-type validation, because the ids it iterates come from
the registry itself, never from unvalidated external input.

**This directly contradicts the FINDINGS.md 2026-09-06 "Dead code: 9 Vector desk exports" entry**,
which removed 6 *sibling* guards (`isVectorStructureId`, `isVectorOscillatorId`,
`isVectorConfluenceId`, `isVectorFlowId`, `isVectorExpectedMoveId`, `isVectorVolumeProfileId`) and
explicitly left these 7 alone because each "sits beside a used sibling (`isVectorOverlayId`,
`isVectorLevelId`, etc.) that IS wired in." That is no longer true — whatever called these between
2026-09-06 and now was itself removed or refactored away, leaving them exactly as dead as the ones
already deleted that day.

**Evidence:** `grep -rn "\bisVectorOverlayId\b\|\bisVectorOpeningRangeMinutes\b\|\bisVectorLevelId\b\|\bisVectorExpectedMoveConeId\b\|\bisVectorGexHeatmapId\b\|\bisVectorGammaRegimeId\b\|\bisVectorBeadDisplayId\b"
--include=*.ts --include=*.tsx src scripts` → only the 7 definitions and their own direct unit
tests, before the fix. `isVectorOverlayFamilyId` (NOT in this list) is confirmed still live via a
real call in `VectorIndicatorMenu.tsx:97`.

**Fix:** Removed all 7 guard functions from `vector-indicators-config.ts`, plus their now-orphaned
backing `Set` constants (`OVERLAY_IDS`, `LEVEL_IDS`, each only read by the guard removed alongside
it). Every id union TYPE (`VectorOverlayId`, `VectorLevelId`, etc.) and its doc comment is
untouched — only the type + its guard are different things, and only the guards were dead.
Updated `vector-indicators-config.test.ts`: removed the tests whose sole purpose was exercising a
removed guard, and trimmed the handful of mixed tests that used a removed guard alongside a still-
live assertion (e.g. `VECTOR_OVERLAY_FAMILIES`'s structural test used `isVectorOverlayId` only to
assert an id is real — replaced with the equivalent direct `VECTOR_OVERLAYS.find` check it already
had on the next line).

**Fix rationale:** Pure deletion — these ids are registry-driven, not external input, so there is
no live need for the guards and no live call site to redirect, exactly as the 2026-09-06 fix found
for their 6 siblings.

**Blast radius:** `src/features/vector/lib/vector-indicators-config.ts`,
`src/features/vector/lib/vector-indicators-config.test.ts` only. No other file imported any of the
7 removed functions.

**Regression guard:** `vector-indicators-config.test.ts` 14/14 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean (confirms every consumer —
`VectorIndicatorMenu.tsx`, `VectorToolbar.tsx`, `VectorBeadRailToggle.tsx`, `VectorChart.tsx`,
`vector-key-levels.ts` — still compiles against the unchanged types).
