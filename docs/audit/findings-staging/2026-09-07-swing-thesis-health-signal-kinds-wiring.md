# Swing "Thesis health" — committed positions never received signalKinds from dossier — FIXED (partial)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-swing-thesis-health-signal-kinds-wiring |
| **Priority** | P3 |
| **Area** | Ask Largo / Night Hawk Swings — thesis health |
| **Status** | FIXED (one of three uncalibrated pillars; setupState/entryStatus remain deferred) |

## Symptom

Follow-on to #4481 (REGIME pillar wiring): `livePlayFromSwingPosition()` still never set
`signalKinds` on committed `HorizonPlay` rows, so `computeSwingThesisHealth()`'s
`flow_corroboration` pillar always fell through to the generic `"no signals"` label and
`thesisHealthUncalibrated()` stayed true even when the commit-time dossier had grounded
FLOW/STRUCTURE/CATALYST pillars.

## Root cause

Discovery provenance (`signalKinds`) was documented as living only on `swing_candidate_accumulation`,
but the commit-time `feature_vector` already pins `pil_flow` / `pil_structure` / `pil_catalyst` —
each a real number only when that pillar was grounded. `livePlayFromSwingPosition()` read `regime`
from `pil_regime` (#4481) but left `signalKinds` unset.

## Fix

`signalKindsFromFeatureVector()` derives `["FLOW","STRUCTURE","CATALYST"]` from grounded dossier
pillars only. Wired into `livePlayFromSwingPosition()` return object. VECTOR/BANGER corroboration
still comes from lane enrichment (`serving-lane.ts`), not fabricated here.

## Scope NOT covered

`setupState` / `entryStatus` are pre-entry WATCH observables not persisted on the position row —
`thesisHealthUncalibrated()` remains true until those are recovered or pinned at commit.

## Evidence

RED→GREEN: `livePlayFromSwingPosition: signalKinds surfaces grounded discovery pillars from dossier`
fails pre-fix (`undefined !== ["FLOW","STRUCTURE"]`). `npx tsx --test src/lib/swing/live-plays.test.ts
src/lib/swing/thesis-health.test.ts` — 58/58 pass. `npx tsc --noEmit` — clean.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
