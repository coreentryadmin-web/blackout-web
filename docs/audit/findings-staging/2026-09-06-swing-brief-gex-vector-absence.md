> **kind:** FINDING

## Swing play-brief: cold GEX / missing Vector not in unavailableSources — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C3 (absence) |

### Symptom

When `fetchEcosystemContext` succeeded but `gex_positioning` was null (cold GEX matrix), or when ecosystem loaded but neither `ctx.vector` nor `ecosystem.vector_full_state` carried a live spot, the brief omitted GEX/Vector sections with no `UnavailableChip`. Total fetch failures were already surfaced via `ecosystemFetchFailed` / `vectorFetchFailed` (#11), but the cold-matrix / no-spot cases were silent.

### Fix

`collectBriefUnavailableSources()` in `play-brief-absence.ts` now emits:
- `{ source: "GEX positioning", reason: "cold matrix / no positioning read" }` when ecosystem read succeeded but `gex_positioning` is null
- `{ source: "Vector desk state", reason: "snapshot unavailable" }` when ecosystem read succeeded but no finite spot on vector paths

Regression tests in `play-brief-absence.test.ts`.
