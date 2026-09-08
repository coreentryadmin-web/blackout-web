> **kind:** FINDING

## Swing play-brief: Vector unavailable_sections not forwarded to envelope — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C3 (absence) |

### Symptom

`fetchVectorFullState` already attaches `unavailable_sections` via `reportVectorAbsences()`, but `collectBriefUnavailableSources()` never read it. When Vector had a live spot but sub-sections (dark pool, technicals, expected move, etc.) were absent, the brief omitted them with no `UnavailableChip`. Vector snapshot staleness (`dataAgeMs > 120s`) was narrated in prose only, not in the structured C3 channel.

### Fix

`collectBriefUnavailableSources()` now forwards `unavailable_sections` (skipping pre-RTH `wall_history` when `wall_history_empty_reason === outside_rth_no_recording_yet`) and emits a structured stale snapshot entry when age exceeds 120s or `freshness === "stale"`.

### Evidence

Regression tests in `play-brief-absence.test.ts`.
